const {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    VoiceConnectionStatus,
    joinVoiceChannel,
    entersState,
    StreamType
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const YouTube = require('./YouTube');
const Spotify = require('./Spotify');
const SoundCloud = require('./SoundCloud');
const DirectLink = require('./DirectLink');
const LanguageManager = require('./LanguageManager');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const { promisify } = require('util');
const { pipeline, Readable } = require('stream');
const pipelineAsync = promisify(pipeline);

let cachedFetch;
async function ensureFetch() {
    if (cachedFetch) return cachedFetch;
    if (typeof global.fetch === 'function') {
        cachedFetch = global.fetch.bind(global);
    } else {
        const mod = await import('node-fetch');
        cachedFetch = mod.default;
    }
    return cachedFetch;
}

class MusicPlayer {
    constructor(guild, textChannel, voiceChannel) {
        this.guild = guild;
        this.textChannel = textChannel;
        this.voiceChannel = voiceChannel;

        // Audio player setup
        this.audioPlayer = createAudioPlayer();
        this.connection = null;
        this.resource = null;

        // Queue management
        this.queue = [];
        this.currentTrack = null;
        this.previousTracks = [];

        // Player settings
        this.volume = config.bot.defaultVolume;
        this.loop = false; // false, 'track', 'queue'
        this.shuffle = false;
        this.autoplay = false;
        this.paused = false;

        // Timestamps
        this.startTime = null;
        this.pausedTime = 0;

        // Filters
        this.currentFilter = null;

        // UI Management
        this.nowPlayingMessage = null;
        this.requesterId = null;

        // Session management - unique ID to prevent old button interactions
        this.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);

        // Preloading system - preload all queued tracks immediately
        this.preloadedStreams = new Map(); // trackUrl -> streamInfo
        this.preloadingQueue = []; // URLs being preloaded

        // Voice connection recovery system
        this.isRecovering = false;
        this.maxRecoveryAttempts = 5;
        this.recoveryAttempts = 0;
        this.recoveryInterval = null;
        this.connectionHealthCheck = null;

        // Playback lifecycle state
        this.trackTimer = null;
        this.isTransitioning = false;
        this.pendingEndReason = null;
        this.currentTrackRetries = 0;
        this.skipRequested = false;
        this.stopRequested = false;
        this.expectedTrackEndTs = null;
        this.currentTrackCache = null;
        this.activeStreamInfo = null;
        this.lastPlaybackPosition = 0;
        this.currentTrackStartOffsetMs = 0;

        // Events setup
        this.setupEvents();


    }

    setupEvents() {
        // Audio player events
        this.audioPlayer.on(AudioPlayerStatus.Playing, () => {

            this.startTime = Date.now();
            this.paused = false;
        });

        this.audioPlayer.on(AudioPlayerStatus.Paused, () => {

            this.pausedTime += Date.now() - this.startTime;
            this.paused = true;
        });

        this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
            this.onPlayerIdle('idle');
        });

        this.audioPlayer.on('error', (error) => {
            console.error('🎵 Audio player error:', error);

            // If it's a stream error and we have a current track, try to recovery
            if (this.currentTrack && error.message &&
                (error.message.includes('stream') || error.message.includes('network'))) {
                this.startConnectionRecovery();
            } else {
                this.handleError(error);
            }
        });

        // Start connection health monitoring
        this.startConnectionHealthCheck();

        // Voice connection events will be set up in setupConnectionEvents()
        this.setupConnectionEvents();
    }

    setupConnectionEvents() {
        if (!this.connection) return;

        this.connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {

            // Don't trigger recovery if we're already recovering or if user disconnected bot
            if (this.isRecovering || newState.reason === 'Manual disconnect') {
                return;
            }

            // Try to auto-reconnect immediately for network disconnections
            try {
                await entersState(this.connection, VoiceConnectionStatus.Connecting, 5000);
                // If we get here, Discord is trying to reconnect automatically
                await entersState(this.connection, VoiceConnectionStatus.Ready, 10000);

            } catch (error) {
                // Auto-reconnect failed, start our recovery system if music is playing
                if (this.currentTrack && !this.paused) {
                    this.startConnectionRecovery();
                }
            }
        });

        this.connection.on(VoiceConnectionStatus.Destroyed, () => {
            // Only start recovery if we have music playing and we're not already recovering
            if (this.currentTrack && !this.paused && !this.isRecovering) {
                this.startConnectionRecovery();
            }
        });

        this.connection.on('error', (error) => {
            console.error('🚨 Voice connection error:', error);
            if (this.currentTrack && !this.paused) {
                this.startConnectionRecovery();
            }
        });

        // Monitor connection status changes
        this.connection.on('stateChange', (oldState, newState) => {
            if (newState.status === VoiceConnectionStatus.Ready) {
                // Connection recovered successfully
                if (this.isRecovering) {
                    this.stopConnectionRecovery();
                }
                this.recoveryAttempts = 0;
            }
        });
    }

    startConnectionHealthCheck() {
        // Check connection health every 30 seconds
        this.connectionHealthCheck = setInterval(async () => {
            try {
                // Check connection health
                if (!this.connection || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
                    if (this.currentTrack && !this.paused && !this.isRecovering) {
                        this.startConnectionRecovery();
                    }
                }

                // Check if voice channel still exists
                const channel = this.guild.channels.cache.get(this.voiceChannel.id);
                if (!channel) {
                    this.cleanup();
                    return;
                }
            } catch (error) {
                console.error('❌ Health check error:', error);
            }
        }, 30000);
    }

    async startConnectionRecovery() {
        if (this.isRecovering) return;

        this.isRecovering = true;
        this.recoveryAttempts = 0;

        // Save current playback position
        this.savePlaybackPosition();

        // Start recovery attempts
        this.recoveryInterval = setInterval(async () => {
            this.recoveryAttempts++;
            if (this.recoveryAttempts > this.maxRecoveryAttempts) {
                this.stopConnectionRecovery();
                return;
            }

            try {
                // Check if voice channel still exists and bot is still in it
                const channel = this.guild.channels.cache.get(this.voiceChannel.id);
                if (!channel) {
                    this.stopConnectionRecovery();
                    return;
                }

                // Try to reconnect
                const reconnected = await this.forceReconnect();

                if (reconnected) {
                    // Resume playback from where we left off
                    await this.resumePlaybackAfterRecovery();
                    this.stopConnectionRecovery();
                }
            } catch (error) {
                console.error(`❌ Recovery attempt ${this.recoveryAttempts} failed:`, error);
            }
        }, 3000); // Try every 3 seconds
    }

    stopConnectionRecovery() {
        if (this.recoveryInterval) {
            clearInterval(this.recoveryInterval);
            this.recoveryInterval = null;
        }
        this.isRecovering = false;
        this.recoveryAttempts = 0;
    }

    savePlaybackPosition() {
        if (this.startTime && !this.paused) {
            const elapsedMs = (Date.now() - this.startTime) + this.pausedTime;
            const totalMs = this.currentTrackStartOffsetMs + elapsedMs;
            this.lastPlaybackPosition = totalMs;
        }
    }

    async forceReconnect() {
        try {
            // Destroy old connection
            if (this.connection) {
                this.connection.destroy();
            }

            // Create new connection
            this.connection = joinVoiceChannel({
                channelId: this.voiceChannel.id,
                guildId: this.guild.id,
                adapterCreator: this.guild.voiceAdapterCreator,
            });

            // Set up events for new connection
            this.setupConnectionEvents();

            // Subscribe audio player
            this.connection.subscribe(this.audioPlayer);

            // Wait for connection to be ready
            await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
            return true;
        } catch (error) {
            console.error('❌ Force reconnect failed:', error);
            return false;
        }
    }

    async resumePlaybackAfterRecovery() {
        if (!this.currentTrack) return;

        try {
            const resumeMs = this.resource
                ? this.currentTrackStartOffsetMs + (this.resource.playbackDuration || 0)
                : this.lastPlaybackPosition || 0;
            await this.play(null, resumeMs);

        } catch (error) {
            console.error('❌ Failed to resume playback:', error);
            // Try to continue with next track
            await this.handleTrackEnd('error');
        }
    }

    async connect() {
        try {
            this.connection = joinVoiceChannel({
                channelId: this.voiceChannel.id,
                guildId: this.guild.id,
                adapterCreator: this.guild.voiceAdapterCreator,
            });

            // Set up connection events
            this.setupConnectionEvents();

            this.connection.subscribe(this.audioPlayer);

            // Wait for connection to be ready
            await entersState(this.connection, VoiceConnectionStatus.Ready, 30000);
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to voice channel:', error);
            return false;
        }
    }

    disconnect() {
        if (this.connection && this.connection.state.status !== 'destroyed') {
            try {
                this.connection.destroy();
            } catch (error) {
            }
        }
        this.connection = null;
    }

    async addTrack(query, requestedBy, platform = 'auto') {
        try {
            let tracks = [];

            // Determine platform and get track info
            if (platform === 'auto') {
                platform = this.detectPlatform(query);
            }

            switch (platform) {
                case 'youtube':
                    tracks = await YouTube.search(query, 1, this.guild.id);
                    break;
                case 'spotify':
                    // Check if it's a Spotify URL for consistency
                    if (Spotify.isSpotifyURL(query)) {
                        tracks = await Spotify.getFromURL(query, this.guild.id);
                    } else {
                        tracks = await Spotify.search(query, 1, 'track', this.guild.id);
                    }
                    break;
                case 'soundcloud':
                    tracks = await SoundCloud.search(query, 1, this.guild.id);
                    break;
                case 'direct':
                    tracks = await DirectLink.getInfo(query);
                    break;
                default:
                    // Default to YouTube search
                    tracks = await YouTube.search(query, 1, this.guild.id);
            }

            if (!tracks || tracks.length === 0) {
                const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.no_results_found');
                return { success: false, message: errorMsg };
            }

            // Add tracks to queue
            const addedTracks = [];
            const wasIdle = !this.currentTrack; // Remember state BEFORE modification

            for (const track of tracks.slice(0, config.bot.maxPlaylistSize)) {
                track.requestedBy = requestedBy;
                track.addedAt = Date.now();

                if (this.currentTrack) {
                    this.queue.push(track);
                } else {
                    this.currentTrack = track;
                }
                addedTracks.push(track);
            }

            // Immediately preload ALL newly added tracks (before playing)
            for (const track of addedTracks) {
                // Skip the first track ONLY if player was idle and this track will start playing immediately
                const isAboutToPlay = wasIdle && track === addedTracks[0];
                if (!isAboutToPlay && !this.preloadedStreams.has(track.url)) {
                    this.preloadTrack(track).catch(err => console.error(`❌ Preload error for ${track.title}:`, err.message));
                }
            }

            // Auto-play if not currently playing
            if (!this.currentTrack && addedTracks.length > 0) {
                this.currentTrack = addedTracks[0];
                await this.play();
            } else if (!this.audioPlayer.state || this.audioPlayer.state.status === AudioPlayerStatus.Idle) {
                await this.play();
            }

            return {
                success: true,
                tracks: addedTracks,
                isPlaylist: tracks.length > 1,
                position: this.queue.length
            };

        } catch (error) {
            const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.error_adding_track');
            return { success: false, message: errorMsg };
        }
    }

    async play(trackIndex = null, seekMs = 0) {
        try {
            // If no current track, get from queue
            if (!this.currentTrack) {
                if (this.queue.length === 0) {
                    const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.no_tracks_in_queue');
                    return { success: false, message: errorMsg };
                }
                this.currentTrack = this.queue.shift();
            }

            // If specific track requested
            if (trackIndex !== null && this.queue[trackIndex]) {
                this.currentTrack = this.queue.splice(trackIndex, 1)[0];
            }

            // Connect to voice channel if not connected
            if (!this.connection) {
                const connected = await this.connect();
                if (!connected) {
                    const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.failed_connect_voice');
                    return { success: false, message: errorMsg };
                }
            }

            // Reset lifecycle flags for new playback
            this.pendingEndReason = null;
            this.skipRequested = false;
            this.stopRequested = false;
            const resumeFromMs = Math.max(0, Math.floor(Number(seekMs) || 0));
            const resumeFromSeconds = resumeFromMs / 1000;
            this.currentTrackStartOffsetMs = resumeFromMs;
            this.lastPlaybackPosition = resumeFromMs;
            this.pausedTime = 0;

            // Get audio stream - check preloaded first!
            let streamUrl = this.currentTrack.url;
            let streamInfo;

            // Try to reuse cache when resuming
            if (resumeFromMs > 0) {
                const cached = this.getCachedStreamForCurrentTrack(resumeFromSeconds);
                if (cached) {
                    streamInfo = cached;
                }
            }

            // Check if stream is already preloaded (only for fresh playback)
            const preloaded = (!streamInfo && resumeFromMs === 0)
                ? this.preloadedStreams.get(this.currentTrack.url)
                : null;
            if (!streamInfo && preloaded) {
                streamInfo = preloaded.info;
                // Remove from cache since we're using it
                this.preloadedStreams.delete(this.currentTrack.url);
            }

            if (!streamInfo) {
                // Get stream normally
                switch (this.currentTrack.platform) {
                    case 'youtube':
                        streamInfo = await YouTube.getStream(streamUrl, this.guild.id, resumeFromSeconds);
                        break;

                    case 'spotify':
                        // Enhanced YouTube search for Spotify tracks

                        // Enhanced search query with multiple attempts
                        const searchQueries = [
                            `"${this.currentTrack.title}" "${this.currentTrack.artist}"`, // Exact match
                            `${this.currentTrack.title} ${this.currentTrack.artist}`,     // Normal search
                            `${this.currentTrack.title}`                                  // Title only
                        ];

                        let ytTrack = null;
                        for (const query of searchQueries) {
                            try {
                                const results = await YouTube.search(query, 3, this.guild.id); // Get 3 results
                                if (results && results.length > 0) {
                                    // Prefer official videos or original versions
                                    ytTrack = results.find(r =>
                                        r.title.toLowerCase().includes('official') ||
                                        r.title.toLowerCase().includes(this.currentTrack.title.toLowerCase())
                                    ) || results[0];
                                    if (ytTrack) break;
                                }
                            } catch (e) {
                            }
                        }

                        if (ytTrack && ytTrack.url) {
                            streamUrl = ytTrack.url;
                            this.currentTrack.youtubeUrl = streamUrl;
                            this.currentTrack.youtubeTitle = ytTrack.title; // Store YouTube title
                            streamInfo = await YouTube.getStream(streamUrl, this.guild.id, resumeFromSeconds);
                        } else {
                            const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.youtube_not_found_spotify').replace('{title}', this.currentTrack.title);
                            throw new Error(errorMsg);
                        }
                        break;

                    case 'soundcloud':
                        streamInfo = await SoundCloud.getStream(streamUrl, this.guild.id, resumeFromSeconds);
                        break;

                    case 'direct':
                        streamInfo = await DirectLink.getStream(streamUrl, resumeFromSeconds);
                        break;

                    default:
                        const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.unsupported_platform').replace('{platform}', this.currentTrack.platform);
                        throw new Error(errorMsg);
                }
            }

            if (!streamInfo) {
                const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.failed_get_audio_stream');
                throw new Error(errorMsg);
            }

            // Handle both old (string) and new (object) stream formats
            let streamUrl_final;

            if (typeof streamInfo === 'string') {
                streamUrl_final = streamInfo;
            } else if (streamInfo && typeof streamInfo === 'object') {
                if (streamInfo.stream) {
                    streamUrl_final = streamInfo.stream;
                } else {
                    streamUrl_final = streamInfo.url;
                }
            } else {
                streamUrl_final = streamInfo;
            }

            // Fetch stream with proper headers for cross-platform compatibility
            let audioStream;

            if (typeof streamInfo === 'object' && streamInfo.stream) {
                // Already a stream object (DirectLink)
                audioStream = streamInfo.stream;
            } else if (typeof streamUrl_final === 'string' && /^https?:\/\//i.test(streamUrl_final)) {
                // Remote URL - fetch with headers
                const fetch = await ensureFetch();
                const headers = (typeof streamInfo === 'object' && streamInfo.httpHeaders) || {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*'
                };

                const response = await fetch(streamUrl_final, {
                    headers,
                    redirect: 'follow'
                });

                if (!response || !response.ok) {
                    throw new Error(`Failed to fetch stream: ${response?.status || 'unknown'}`);
                }

                // Convert web stream to Node.js Readable
                if (typeof response.body?.getReader === 'function' && typeof Readable.fromWeb === 'function') {
                    audioStream = Readable.fromWeb(response.body);
                } else {
                    audioStream = response.body;
                }
            } else {
                // Local file or already a stream
                audioStream = streamUrl_final;
            }

            // Transcode through FFmpeg for reliable cross-platform playback
            const ffmpegProcess = new prism.FFmpeg({
                command: ffmpegPath,
                args: [
                    '-analyzeduration', '0',
                    '-loglevel', '0',
                    '-i', 'pipe:0',
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2'
                ]
            });

            ffmpegProcess.on('error', (err) => {
                // Ignore "Premature close" - it's expected when tracks end/skip
                if (err.message && err.message.includes('Premature close')) return;
                console.error('❌ FFmpeg error:', err.message);
            });

            // Pipe audio stream into ffmpeg
            audioStream.pipe(ffmpegProcess);

            // Create audio resource with enhanced buffer settings for complete playback
            this.resource = createAudioResource(ffmpegProcess, {
                inputType: StreamType.Raw,
                inlineVolume: true,
                silencePaddingFrames: 10,
                metadata: {
                    title: this.currentTrack.title,
                    url: this.currentTrack.url,
                    duration: streamInfo.duration || this.currentTrack.duration,
                    bitrate: streamInfo.bitrate || 128
                }
            });

            // Set volume
            if (this.resource.volume) {
                this.resource.volume.setVolume(this.volume / 100);
            }

            // Update track duration from stream info if available
            if (streamInfo && streamInfo.duration && streamInfo.duration > 0) {
                this.currentTrack.duration = streamInfo.duration;
            }

            // Play the resource
            this.audioPlayer.play(this.resource);

            // Store active stream info for quick resume
            const baseSourceUrl = typeof streamInfo === 'object'
                ? (streamInfo.rawUrl || streamInfo.url || (typeof streamUrl_final === 'string' ? streamUrl_final : null))
                : streamUrl_final;

            this.activeStreamInfo = {
                trackKey: this.getTrackCacheKey(this.currentTrack),
                platform: this.currentTrack.platform,
                fetchedAt: Date.now(),
                resumeSupported: typeof streamInfo === 'object' ? Boolean(streamInfo.canSeek) : false,
                baseUrl: baseSourceUrl,
                info: typeof streamInfo === 'object' ? streamInfo : { url: streamUrl_final }
            };

            // Cache current stream for future resume attempts
            this.currentTrackCache = this.activeStreamInfo;

            // Schedule watchdog to ensure proper completion and prevent premature transitions
            this.scheduleTrackWatchdog(streamInfo);

            return { success: true, track: this.currentTrack };

        } catch (error) {
            await this.handleError(error);
            const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.track_could_not_play');
            return { success: false, message: errorMsg };
        }
    }

    scheduleTrackWatchdog(streamInfo = null) {
        if (this.trackTimer) {
            clearTimeout(this.trackTimer);
        }

        const streamDuration = streamInfo && Number(streamInfo.duration) > 0 ? Number(streamInfo.duration) : null;
        const trackDuration = this.currentTrack && Number(this.currentTrack.duration) > 0 ? Number(this.currentTrack.duration) : null;
        const durationSeconds = streamDuration || trackDuration;

        if (durationSeconds) {
            this.expectedTrackEndTs = Date.now() + durationSeconds * 1000;
            const timeoutMs = Math.max(durationSeconds * 1000 + 4000, 5000);
            this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), timeoutMs);
        } else {
            // Fallback watchdog: check every 5 minutes for streams without known duration
            this.expectedTrackEndTs = null;
            this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), 5 * 60 * 1000);
        }
    }

    getTrackCacheKey(track) {
        if (!track) return null;
        return track.id || track.url || `${track.title}-${track.duration}`;
    }

    getCachedStreamForCurrentTrack(seekSeconds) {
        if (!this.currentTrackCache) return null;
        const key = this.getTrackCacheKey(this.currentTrack);
        if (!key || this.currentTrackCache.trackKey !== key) return null;
        if (!this.currentTrackCache.resumeSupported || !this.currentTrackCache.baseUrl) return null;
        const seekUrl = this.applySeekToUrl(this.currentTrackCache.baseUrl, seekSeconds);
        if (!seekUrl) return null;

        return {
            ...this.currentTrackCache.info,
            url: seekUrl,
            canSeek: true,
            fromCache: true,
            duration: this.currentTrackCache.info?.duration || this.currentTrack.duration
        };
    }

    applySeekToUrl(baseUrl, seekSeconds) {
        if (!baseUrl) return null;
        if (seekSeconds <= 0) return baseUrl;

        let url = baseUrl.replace(/(&|\?)begin=\d+/g, '');
        url = url.replace(/(&|\?)start=\d+/g, '');

        const isYouTubeStream = /googlevideo\.com/i.test(url);
        if (!isYouTubeStream) {
            // TODO: add support for other providers when available
            return null;
        }

        const separator = url.includes('?') ? '&' : '?';
        const startMs = Math.max(0, Math.floor(seekSeconds * 1000));
        return `${url}${separator}begin=${startMs}`;
    }

    ensureTrackCompletion() {
        if (!this.currentTrack) {
            this.trackTimer = null;
            return;
        }

        const status = this.audioPlayer.state?.status;

        if (status === AudioPlayerStatus.Playing) {
            const playbackMs = this.resource?.playbackDuration || 0;
            const durationMs = (Number(this.currentTrack.duration) || 0) * 1000;

            if (durationMs > 0 && playbackMs + 1500 < durationMs) {
                const remainingMs = Math.max(durationMs - playbackMs, 2000);
                this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), remainingMs);
                return;
            }

            // Gracefully stop to emit Idle and let lifecycle handler run
            if (!this.pendingEndReason) {
                this.pendingEndReason = 'watchdog';
            }
            this.audioPlayer.stop();
            this.trackTimer = null;
            return;
        }

        if (status === AudioPlayerStatus.Idle || status === AudioPlayerStatus.AutoPaused) {
            // Idle handler will take care, nothing to do
            this.trackTimer = null;
            return;
        }

        // Unknown state, keep watching
        this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), 2000);
    }

    onPlayerIdle(trigger = 'idle') {
        const reason = this.consumePendingEndReason(trigger);

        // Slight delay to allow playback stats to finalize
        setTimeout(() => {
            this.handleTrackEnd(reason).catch(console.error);
        }, 60);
    }

    consumePendingEndReason(defaultReason = 'idle') {
        const reason = this.pendingEndReason || defaultReason;
        this.pendingEndReason = null;
        return reason;
    }

    pause() {
        if (this.audioPlayer.state.status === AudioPlayerStatus.Playing) {
            this.audioPlayer.pause();
            this.paused = true;
            return true;
        }
        return false;
    }

    resume() {
        if (this.audioPlayer.state.status === AudioPlayerStatus.Paused) {
            this.audioPlayer.unpause();
            this.paused = false;
            return true;
        }
        return false;
    }

    stop() {
        // Clear track timer
        if (this.trackTimer) {
            clearTimeout(this.trackTimer);
            this.trackTimer = null;
        }

        this.queue = [];
        this.currentTrack = null;
        this.pendingEndReason = 'stop';
        this.stopRequested = true;
        this.currentTrackStartOffsetMs = 0;
        this.lastPlaybackPosition = 0;
        this.audioPlayer.stop(true);
        this.disconnect();
    }

    skip() {
        if (this.currentTrack) {
            // Clear track timer
            if (this.trackTimer) {
                clearTimeout(this.trackTimer);
                this.trackTimer = null;
            }

            this.pendingEndReason = 'skip';
            this.skipRequested = true;
            this.audioPlayer.stop(true);
            return true;
        }
        return false;
    }

    previous() {
        if (this.previousTracks.length > 0) {
            if (this.currentTrack) {
                this.queue.unshift(this.currentTrack);
            }
            this.currentTrack = this.previousTracks.pop();
            this.audioPlayer.stop(); // This will trigger play
            return true;
        }
        return false;
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(100, volume));
        if (this.resource && this.resource.volume) {
            this.resource.volume.setVolume(this.volume / 100);
        }
        return this.volume;
    }

    shuffleQueue() {
        if (this.queue.length > 1) {
            for (let i = this.queue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
            }
            return true;
        }
        return false;
    }

    setLoop(mode) {
        // mode: false, 'track', 'queue'
        this.loop = mode;
        return this.loop;
    }

    setShuffle(enabled) {
        this.shuffle = enabled;
        return this.shuffle;
    }

    clearQueue() {
        const cleared = this.queue.length;
        this.queue = [];
        return cleared;
    }

    removeFromQueue(index) {
        if (index >= 0 && index < this.queue.length) {
            return this.queue.splice(index, 1)[0];
        }
        return null;
    }

    moveInQueue(from, to) {
        if (from >= 0 && from < this.queue.length && to >= 0 && to < this.queue.length) {
            const track = this.queue.splice(from, 1)[0];
            this.queue.splice(to, 0, track);
            return true;
        }
        return false;
    }

    getQueue() {
        return {
            current: this.currentTrack,
            queue: this.queue,
            previous: this.previousTracks,
            totalTracks: (this.currentTrack ? 1 : 0) + this.queue.length,
            duration: this.getTotalDuration(),
        };
    }

    getTotalDuration() {
        let total = 0;
        if (this.currentTrack && this.currentTrack.duration) {
            total += this.currentTrack.duration;
        }
        this.queue.forEach(track => {
            if (track.duration) total += track.duration;
        });
        return total;
    }

    getCurrentTime() {
        if (!this.startTime) return this.currentTrackStartOffsetMs;
        if (this.paused) {
            return this.currentTrackStartOffsetMs + this.pausedTime;
        }
        return this.currentTrackStartOffsetMs + (Date.now() - this.startTime) + this.pausedTime;
    }

    // Timer-based track completion - no more unreliable Idle events!

    async handleTrackEnd(reason = 'idle') {
        if (this.isTransitioning) {
            return;
        }

        this.isTransitioning = true;

        try {
            if (this.trackTimer) {
                clearTimeout(this.trackTimer);
                this.trackTimer = null;
            }

            const finishedTrack = this.currentTrack;
            const playbackMs = this.resource?.playbackDuration || 0;
            const totalPlaybackMs = this.currentTrackStartOffsetMs + playbackMs;
            this.lastPlaybackPosition = totalPlaybackMs;
            const durationMs = finishedTrack && Number(finishedTrack.duration) > 0 ? Number(finishedTrack.duration) * 1000 : 0;
            const manualSkip = reason === 'skip' || reason === 'stop';
            const endedUnexpectedly = Boolean(finishedTrack) && !manualSkip && durationMs > 0 && totalPlaybackMs + 1500 < durationMs;

            if (endedUnexpectedly) {
                this.currentTrackRetries += 1;
                if (this.currentTrackRetries <= 2) {
                    // Attempt to resume the same track from the last known position
                    await this.play(null, totalPlaybackMs);
                    return;
                } else {
                }
            } else {
                this.currentTrackRetries = 0;
            }

            if (!finishedTrack) {
                this.resource = null;
                return;
            }

            this.previousTracks.push(finishedTrack);

            if (this.loop === 'track') {
                await this.play();
                return;
            }

            if (this.loop === 'queue') {
                this.queue.push(finishedTrack);
            }

            this.resource = null;
            this.expectedTrackEndTs = null;
            this.startTime = null;
            this.pausedTime = 0;
            this.lastPlaybackPosition = 0;
            this.currentTrackStartOffsetMs = 0;
            this.currentTrackCache = null;

            if (this.queue.length > 0) {
                if (this.shuffle) {
                    const randomIndex = Math.floor(Math.random() * this.queue.length);
                    this.currentTrack = this.queue.splice(randomIndex, 1)[0];
                } else {
                    this.currentTrack = this.queue.shift();
                }

                await this.play();

                const MusicEmbedManager = require('./MusicEmbedManager');
                if (global.clients && global.clients.musicEmbedManager) {
                    await global.clients.musicEmbedManager.updateNowPlayingEmbed(this);
                }

                return;
            }

            if (this.autoplay) {
                this.currentTrackRetries = 0;
                await this.handleAutoplay();
                return;
            }

            this.currentTrack = null;
            this.currentTrackCache = null;
            this.currentTrackStartOffsetMs = 0;

            const MusicEmbedManager = require('./MusicEmbedManager');
            if (global.clients && global.clients.musicEmbedManager) {
                await global.clients.musicEmbedManager.handlePlaybackEnd(this);
            } else {
                await this.showQueueCompleted();
            }

            setTimeout(() => {
                if (this.queue.length === 0 && !this.currentTrack) {
                    this.cleanup();
                }
            }, 5 * 60 * 1000);
        } finally {
            this.isTransitioning = false;
            this.skipRequested = false;
            this.stopRequested = false;
            this.pendingEndReason = null;
        }
    }

    async handleAutoplay() {
        // Implementation for autoplay feature
        // This would search for related tracks based on the current track
    }

    async handleError(error) {

        // Try to skip to next track on error
        if (this.queue.length > 0) {
            this.currentTrack = this.queue.shift();
            await this.play();
        } else {
            this.currentTrack = null;
            const errorMsg = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.error_playlist_stopped');
            await this.textChannel.send(errorMsg);
        }
    }

    detectPlatform(query) {

        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            return 'youtube';
        } else if (query.includes('spotify.com')) {
            return 'spotify';
        } else if (query.includes('soundcloud.com')) {
            return 'soundcloud';
        } else if (query.match(/^https?:\/\/.*\.(mp3|wav|ogg|flac|m4a|aac|wma|opus|webm|mp4)$/i)) {
            return 'direct';
        }
        return 'youtube'; // Default to YouTube search
    }

    // Preloading System
    async preloadTrack(track) {
        if (!track || this.preloadedStreams.has(track.url)) return;

        // Prevent duplicate preloading
        if (this.preloadingQueue.includes(track.url)) return;
        this.preloadingQueue.push(track.url);

        try {
            let streamUrl = track.url;
            let streamInfo;

            switch (track.platform) {
                case 'youtube':
                    streamInfo = await YouTube.getStream(streamUrl, this.guild.id);
                    break;
                case 'spotify':
                    // Use cached YouTube URL if available
                    if (track.youtubeUrl) {
                        streamUrl = track.youtubeUrl;
                        streamInfo = await YouTube.getStream(streamUrl, this.guild.id);
                    } else {
                        // Quick YouTube search for Spotify
                        const query = `"${track.title}" "${track.artist}"`;
                        const results = await YouTube.search(query, 1, this.guild.id);
                        if (results && results.length > 0) {
                            streamUrl = results[0].url;
                            track.youtubeUrl = streamUrl; // Cache for future use
                            streamInfo = await YouTube.getStream(streamUrl, this.guild.id);
                        }
                    }
                    break;
                case 'soundcloud':
                    streamInfo = await SoundCloud.getStream(streamUrl, this.guild.id);
                    break;
                case 'direct':
                    streamInfo = await DirectLink.getStream(streamUrl);
                    break;
            }

            if (streamInfo) {
                // Cache stream info - keep until played
                this.preloadedStreams.set(track.url, {
                    info: streamInfo,
                    track: track
                });
            }
        } catch (error) {
            console.error(`❌ Preload failed for ${track.title}:`, error.message);
        } finally {
            // Remove from preloading queue
            const index = this.preloadingQueue.indexOf(track.url);
            if (index > -1) this.preloadingQueue.splice(index, 1);
        }
    }

    getPlatformEmoji(platform) {
        const emojis = {
            youtube: '🔴',
            spotify: '🟢',
            soundcloud: '🟠',
            direct: '🔗'
        };
        return emojis[platform] || '🎵';
    }

    async showQueueCompleted() {
        if (!this.nowPlayingMessage || !this.textChannel) return;

        try {
            const completedTitle = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.queue_completed');
            const completedDesc = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.queue_completed_desc');

            const embed = new EmbedBuilder()
                .setTitle(completedTitle)
                .setDescription(completedDesc)
                .setColor('#00ff00')
                .setTimestamp();

            // Create disabled buttons
            const disabledButtons = await this.createControlButtons(true);

            await this.nowPlayingMessage.edit({
                embeds: [embed],
                components: disabledButtons
            });

        } catch (error) {
            // Message might be deleted, clear reference
            this.nowPlayingMessage = null;
        }
    }

    formatDuration(seconds) {
        // Ensure seconds is integer and handle floating point errors
        const totalSeconds = Math.floor(Number(seconds) || 0);
        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    cleanup() {
        try {
            // Stop recovery system
            this.stopConnectionRecovery();

            // Clear health check timer
            if (this.connectionHealthCheck) {
                clearInterval(this.connectionHealthCheck);
                this.connectionHealthCheck = null;
            }

            // Clear track timer
            if (this.trackTimer) {
                clearTimeout(this.trackTimer);
                this.trackTimer = null;
            }

            // Stop audio player
            if (this.audioPlayer) {
                this.audioPlayer.stop();
                this.audioPlayer.removeAllListeners();
            }

            // Disconnect from voice channel
            if (this.connection) {
                this.connection.removeAllListeners();
                if (this.connection.state.status !== 'destroyed') {
                    try {
                        this.connection.destroy();
                    } catch (error) {
                        console.error('Error destroying connection:', error);
                    }
                }
                this.connection = null;
            }

            // Clear resources
            if (this.resource) {
                try {
                    this.resource.playStream.destroy();
                } catch (e) {
                    // Stream might already be destroyed
                }
                this.resource = null;
            }

            // Clear preloaded streams
            this.preloadedStreams.clear();
            this.preloadingQueue = [];

            // Clear player data
            this.queue = [];
            this.currentTrack = null;
            this.previousTracks = [];
            this.startTime = null;
            this.pausedTime = 0;
            this.currentTrackCache = null;
            this.activeStreamInfo = null;

            // Clear recovery data
            this.isRecovering = false;
            this.recoveryAttempts = 0;
            this.lastPlaybackPosition = 0;
            this.currentTrackStartOffsetMs = 0;

            // Clear UI references
            this.nowPlayingMessage = null;
            this.requesterId = null;
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }



    getStatus() {
        return {
            connected: !!this.connection,
            playing: this.audioPlayer.state.status === AudioPlayerStatus.Playing,
            paused: this.audioPlayer.state.status === AudioPlayerStatus.Paused,
            queue: this.queue.length,
            volume: this.volume,
            loop: this.loop,
            shuffle: this.shuffle,
            currentTrack: this.currentTrack,
            voiceChannel: this.voiceChannel.name,
            textChannel: this.textChannel.name,
        };
    }

    // Clean up resources when destroying the player
    destroy() {
        // Clear track timer
        if (this.trackTimer) {
            clearTimeout(this.trackTimer);
            this.currentTrackCache = null;
            this.activeStreamInfo = null;
            this.lastPlaybackPosition = 0;
        }

        // Clear preloaded streams
        if (this.preloadedStreams) {
            this.preloadedStreams.clear();
        }

        // Stop audio and disconnect
        if (this.audioPlayer) {
            this.audioPlayer.stop();
        }

        if (this.connection) {
            this.connection.destroy();
        }
    }
}

module.exports = MusicPlayer;