const { Events, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../config');
const LanguageManager = require('../src/LanguageManager');
const MusicPlayer = require('../src/MusicPlayer');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;

        const client = interaction.client;
        const guild = interaction.guild;
        const member = interaction.member;

        // Special controls for search buttons
        if (interaction.customId.startsWith('search_')) {
            return await this.handleSearchInteraction(interaction, client);
        }

        // Language selection buttons
        if (interaction.customId.startsWith('language_')) {
            const languageCommand = require('../commands/language.js');
            return await languageCommand.handleLanguageButton(interaction);
        }

        // Check if user is in a voice channel
        if (!member.voice.channel) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.voice_channel_required'),
                flags: [1 << 6]
            });
        }

        // Get music player
        const player = client.players.get(guild.id);
        if (!player) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.no_music_playing'),
                flags: [1 << 6]
            });
        }

        // Check if user is in the same voice channel as bot
        if (player.voiceChannel.id !== member.voice.channel.id) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.same_channel_required'),
                flags: [1 << 6]
            });
        }

        try {
            // Parse custom ID for authorization and session validation
            const customIdParts = interaction.customId.split(':');
            const [buttonType, requesterId, sessionId] = customIdParts;

            // Session validation for authorized buttons (skip queue button)
            if (sessionId && player.sessionId && sessionId !== player.sessionId) {
                return await interaction.reply({
                    content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.session_invalid'),
                    flags: [1 << 6]
                });
            }

            switch (buttonType) {
                case 'music_pause':
                    await this.handlePause(interaction, player, requesterId);
                    break;

                case 'music_skip':
                    await this.handleSkip(interaction, player, requesterId);
                    break;

                case 'music_stop':
                    await this.handleStop(interaction, player, client, requesterId);
                    break;

                case 'music_queue':
                    await this.handleQueue(interaction, player);
                    break;

                case 'music_shuffle':
                    await this.handleShuffle(interaction, player, requesterId);
                    break;

                case 'music_volume':
                    await this.handleVolumeModal(interaction, player, requesterId);
                    break;

                case 'help_refresh':
                    await this.handleHelpRefresh(interaction);
                    break;

                default:
                    await interaction.reply({
                        content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.unknown_interaction'),
                        flags: [1 << 6]
                    });
            }
        } catch (error) {

            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({
                        content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.processing_error'),
                        flags: [1 << 6]
                    });
                } catch (replyError) {
                }
            }
        }
    },

    // Authorization control function
    isAuthorized(interaction, requesterId) {
        const member = interaction.member;

        // Admin permission check
        if (member.permissions.has('Administrator')) return true;

        // DJ role check (if exists)
        if (member.roles.cache.some(role => role.name.toLowerCase().includes('dj'))) return true;

        // Music starter check
        if (member.id === requesterId) return true;

        return false;
    },

    async handlePause(interaction, player, requesterId) {

        // Authorization check
        if (!this.isAuthorized(interaction, requesterId)) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.not_authorized'),
                flags: [1 << 6]
            });
        }

        if (!player.currentTrack) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.no_song_playing'),
                flags: [1 << 6]
            });
        }

        let result;
        let message;
        let emoji;

        if (player.paused) {
            result = player.resume();
            message = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.music_resumed');
            emoji = '▶️';
        } else {
            result = player.pause();
            message = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.music_paused');
            emoji = '⏸️';
        }

        if (result) {
            const actionByLabel = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.action_by');
            const embed = new EmbedBuilder()
                .setTitle(`${emoji} ${message}`)
                .setDescription(`**[${player.currentTrack.title}](${player.currentTrack.url})** ${message}!`)
                .setColor(config.bot.embedColor)
                .setTimestamp()
                .addFields({
                    name: actionByLabel,
                    value: `${interaction.member}`,
                    inline: true
                });

            if (player.currentTrack.thumbnail) {
                embed.setThumbnail(player.currentTrack.thumbnail);
            }

            await interaction.reply({ embeds: [embed], flags: [1 << 6] });

            // Ana embed'deki butonları güncelle (pause/resume değişimi)
            if (interaction.client.musicEmbedManager) {
                await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
            }
        } else {
            await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.operation_failed'),
                flags: [1 << 6]
            });
        }
    },

    async handleSkip(interaction, player, requesterId) {
        // Authorization check
        if (!this.isAuthorized(interaction, requesterId)) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.not_authorized'),
                flags: [1 << 6]
            });
        }

        if (!player.currentTrack) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.no_song_playing'),
                flags: [1 << 6]
            });
        }

        // Sırada müzik yoksa atlanamaz
        if (player.queue.length === 0) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.no_songs_to_skip'),
                flags: [1 << 6]
            });
        }

        const currentTrack = player.currentTrack;
        const skipped = player.skip();

        if (skipped) {
            const embed = new EmbedBuilder()
                .setTitle(await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.song_skipped_title'))
                .setDescription(`**[${currentTrack.title}](${currentTrack.url})** ${await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.skipped')}!`)
                .setColor(config.bot.embedColor)
                .setTimestamp()
                .addFields({
                    name: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.skipped_by'),
                    value: `${interaction.member}`,
                    inline: true
                });

            if (player.queue.length > 0) {
                embed.addFields({
                    name: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.next_song'),
                    value: `[${player.queue[0].title}](${player.queue[0].url})`,
                    inline: false
                });
                embed.setFooter({
                    text: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.more_songs_in_queue', { count: player.queue.length })
                });
            } else {
                embed.setFooter({
                    text: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.no_more_songs')
                });
            }

            if (currentTrack.thumbnail) {
                embed.setThumbnail(currentTrack.thumbnail);
            }

            await interaction.reply({ embeds: [embed], flags: [1 << 6] });

            // Embed Manager ile ana embed'i güncelle
            if (interaction.client.musicEmbedManager && player.currentTrack) {
                await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
            }
        } else {
            await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.song_not_skipped'),
                flags: [1 << 6]
            });
        }
    },

    async handlePrevious(interaction, player) {
        if (player.previousTracks.length === 0) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.no_previous_song'),
                flags: [1 << 6]
            });
        }

        const result = player.previous();

        if (result) {
            await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.moved_to_previous'),
                flags: [1 << 6]
            });
        } else {
            await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.previous_failed'),
                flags: [1 << 6]
            });
        }
    },

    async handleStop(interaction, player, client, requesterId) {
        // Authorization check
        if (!this.isAuthorized(interaction, requesterId)) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.not_authorized'),
                flags: [1 << 6]
            });
        }

        const queueLength = player.queue.length;
        const currentTrack = player.currentTrack;

        player.stop();
        client.players.delete(interaction.guild.id);

        const embed = new EmbedBuilder()
            .setTitle(await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.music_stopped_title'))
            .setDescription(`${currentTrack ? `**[${currentTrack.title}](${currentTrack.url})**` : 'Music'} ${await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.stopped')}!`)
            .setColor('#FF0000')
            .setTimestamp()
            .addFields({
                name: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.stopped_by'),
                value: `${interaction.member}`,
                inline: true
            });

        if (queueLength > 0) {
            embed.setFooter({
                text: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.songs_cleared', { count: queueLength })
            });
        }

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });

        // Ana embed'deki butonları disable yap
        if (client.musicEmbedManager) {
            await client.musicEmbedManager.handlePlaybackEnd(player);
        }
    },

    async handleQueue(interaction, player) {
        const queueInfo = player.getQueue();

        if (!queueInfo.current && queueInfo.queue.length === 0) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.no_songs_in_queue'),
                flags: [1 << 6]
            });
        }

        const queueTitle = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.play_queue_title');
        const embed = new EmbedBuilder()
            .setTitle(queueTitle)
            .setColor(config.bot.embedColor)
            .setTimestamp();

        // Current track
        if (queueInfo.current) {
            const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
            const progress = this.createProgressBar(currentTime, queueInfo.current.duration);

            embed.addFields({
                name: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.now_playing'),
                value: `**[${queueInfo.current.title}](${queueInfo.current.url})**\n${progress}`,
                inline: false
            });
        }

        // Queue tracks
        if (queueInfo.queue.length > 0) {
            let queueText = '';
            const tracks = queueInfo.queue.slice(0, 10); // Show first 10

            tracks.forEach((track, index) => {
                queueText += `\`${index + 1}.\` **[${track.title}](${track.url})**\n`;
            });

            if (queueInfo.queue.length > 10) {
                queueText += `\n*${await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.and_more', { count: queueInfo.queue.length - 10 })}*`;
            }

            embed.addFields({
                name: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.upcoming_songs', { count: queueInfo.queue.length }),
                value: queueText,
                inline: false
            });
        }

        embed.setFooter({
            text: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.total_songs', { count: queueInfo.queue.length + (queueInfo.current ? 1 : 0) })
        });

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });
    },

    async handleShuffle(interaction, player, requesterId) {
        // Authorization check
        if (!this.isAuthorized(interaction, requesterId)) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.not_authorized'),
                flags: [1 << 6]
            });
        }

        if (player.queue.length < 2) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.minimum_songs_shuffle'),
                flags: [1 << 6]
            });
        }

        // Shuffle the queue
        player.shuffleQueue();

        const shuffleTitle = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.queue_shuffled_title');
        const shuffleDesc = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.songs_shuffled', { count: player.queue.length });
        const shuffledByLabel = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.shuffled_by');

        const embed = new EmbedBuilder()
            .setTitle(shuffleTitle)
            .setDescription(shuffleDesc)
            .setColor(config.bot.embedColor)
            .setTimestamp()
            .addFields({
                name: shuffledByLabel,
                value: `${interaction.member}`,
                inline: true
            });

        // Show first few shuffled tracks
        if (player.queue.length > 0) {
            const nextTracks = player.queue.slice(0, 3);
            let trackList = '';
            nextTracks.forEach((track, index) => {
                trackList += `${index + 1}. **[${track.title}](${track.url})**\n`;
            });

            const nextSongsLabel = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.next_songs');
            embed.addFields({
                name: nextSongsLabel,
                value: trackList,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });

        // Ana embed'i güncelle
        if (interaction.client.musicEmbedManager) {
            await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
    },

    async handleVolumeModal(interaction, player, requesterId) {
        // Authorization check
        if (!this.isAuthorized(interaction, requesterId)) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.not_authorized'),
                flags: [1 << 6]
            });
        }

        const volumeTitle = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.set_volume_title');
        const volumeLabel = await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.volume_label');

        const modal = new ModalBuilder()
            .setCustomId('volume_modal')
            .setTitle(volumeTitle);

        const volumeInput = new TextInputBuilder()
            .setCustomId('volume_input')
            .setLabel(volumeLabel)
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(3)
            .setPlaceholder('50')
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(volumeInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    },

    createProgressBar(current, total) {
        if (!total || total === 0) return '0:00 / 0:00';

        const currentSeconds = Math.floor(current / 1000);
        const totalSeconds = Math.floor(total);
        const progress = Math.floor((currentSeconds / totalSeconds) * 20);

        const bar = '█'.repeat(progress) + '░'.repeat(20 - progress);

        return `${this.formatTime(currentSeconds)} [${'▓'.repeat(progress)}${'░'.repeat(20 - progress)}] ${this.formatTime(totalSeconds)}`;
    },

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    },

    async handleHelpRefresh(interaction) {
        try {
            // Clear language cache to ensure fresh language data
            await LanguageManager.refreshServerLanguage(interaction.guild.id);

            await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.refreshing_help'),
                flags: [1 << 6]
            });

            // Simulate refresh - just re-run the help command
            const helpCommand = require('../commands/help.js');
            await helpCommand.execute(interaction, interaction.client);

        } catch (error) {
            await interaction.reply({
                content: await LanguageManager.getTranslation(interaction.guild?.id, 'buttonhandler.refresh_error'),
                flags: [1 << 6]
            });
        }
    },

    async handleSearchInteraction(interaction, client) {
        const member = interaction.member;
        const guild = interaction.guild;

        // Check if user is in a voice channel
        if (!member.voice.channel) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.voice_channel_required'),
                flags: [1 << 6]
            });
        }

        // Check search results
        if (!global.searchResults || !global.searchResults.has(interaction.user.id)) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.search_expired'),
                flags: [1 << 6]
            });
        }

        const userSearchData = global.searchResults.get(interaction.user.id);

        if (interaction.customId === 'search_cancel') {
            global.searchResults.delete(interaction.user.id);

            const embed = new EmbedBuilder()
                .setTitle(await LanguageManager.getTranslation(guild?.id, 'buttonhandler.search_cancelled_title'))
                .setDescription(await LanguageManager.getTranslation(guild?.id, 'buttonhandler.search_cancelled_desc'))
                .setColor('#FF0000')
                .setTimestamp();

            return await interaction.update({
                embeds: [embed],
                components: []
            });
        }

        // Get selected song index
        const selectedIndex = parseInt(interaction.customId.replace('search_select_', ''));
        const selectedTrack = userSearchData.results[selectedIndex];

        if (!selectedTrack) {
            return await interaction.reply({
                content: await LanguageManager.getTranslation(guild?.id, 'buttonhandler.invalid_selection'),
                flags: [1 << 6]
            });
        }

        await interaction.deferUpdate();

        // Işlem mesajı göster
        const processingEmbed = new EmbedBuilder()
            .setTitle('🔄 ' + await LanguageManager.getTranslation(guild?.id, 'buttonhandler.processing'))
            .setDescription(await LanguageManager.getTranslation(guild?.id, 'buttonhandler.adding_song_desc', { title: selectedTrack.title }))
            .setColor('#FFAA00')
            .setTimestamp();

        await interaction.editReply({
            embeds: [processingEmbed],
            components: []
        });

        try {
            // Embed Manager ile işle
            const MusicEmbedManager = require('../src/MusicEmbedManager');
            if (!client.musicEmbedManager) {
                client.musicEmbedManager = new MusicEmbedManager(client);
            }

            // Ensure music player exists and is configured
            if (!client.players) {
                client.players = new Map();
            }

            let player = client.players.get(guild.id);
            if (!player) {
                player = new MusicPlayer(guild, interaction.channel, member.voice.channel);
                client.players.set(guild.id, player);
            }

            player.voiceChannel = member.voice.channel;
            player.textChannel = interaction.channel;

            // Seçilen şarkıyı işle
            const result = await client.musicEmbedManager.handleMusicData(
                guild.id,
                {
                    isPlaylist: false,
                    tracks: [selectedTrack]
                },
                member,
                interaction
            );

            // Search results temizle
            global.searchResults.delete(interaction.user.id);

            if (!result.success) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ ' + await LanguageManager.getTranslation(guild?.id, 'buttonhandler.error_title'))
                    .setDescription(result.message)
                    .setColor('#FF0000')
                    .setTimestamp();

                return await interaction.editReply({
                    embeds: [errorEmbed],
                    components: []
                });
            }

        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ ' + await LanguageManager.getTranslation(guild?.id, 'buttonhandler.error_title'))
                .setDescription(await LanguageManager.getTranslation(guild?.id, 'buttonhandler.processing_error'))
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({
                embeds: [errorEmbed],
                components: []
            });
        }
    }
};
