const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const chalk = require('chalk');

require("./src/commandLoader"); // Load and deploy commands


setTimeout(() => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMembers,
        ]
    });

    // Collections for commands and music players
    client.commands = new Collection();
    client.players = new Collection();

    // Initialize Music Embed Manager
    const MusicEmbedManager = require('./src/MusicEmbedManager');
    client.musicEmbedManager = new MusicEmbedManager(client);

    // Global reference for MusicPlayer'dan erişim
    if (!global.clients) global.clients = {};
    global.clients.musicEmbedManager = client.musicEmbedManager;

    // Load command files
    const loadCommands = () => {
        const commandsPath = path.join(__dirname, 'commands');

        // Create commands directory if it doesn't exist
        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(commandsPath, { recursive: true });
        }

        try {
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

            for (const file of commandFiles) {
                const filePath = path.join(commandsPath, file);
                const command = require(filePath);

                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    console.log(chalk.green(`✓ Loaded command: ${command.data.name}`));
                } else {
                    console.log(chalk.yellow(`⚠ Warning: ${file} is missing required "data" or "execute" property.`));
                }
            }
        } catch (error) {
            console.log(chalk.yellow('⚠ No commands directory found, skipping command loading.'));
        }
    };

    // Load event handlers
    const loadEvents = () => {
        const eventsPath = path.join(__dirname, 'events');

        // Create events directory if it doesn't exist
        if (!fs.existsSync(eventsPath)) {
            fs.mkdirSync(eventsPath, { recursive: true });
        }

        try {
            const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

            for (const file of eventFiles) {
                const filePath = path.join(eventsPath, file);
                const event = require(filePath);

                if (event.once) {
                    client.once(event.name, (...args) => event.execute(...args));
                } else {
                    client.on(event.name, (...args) => event.execute(...args));
                }
                console.log(chalk.green(`✓ Loaded event: ${event.name}`));
            }
        } catch (error) {
            console.log(chalk.yellow('⚠ No events directory found, using default events.'));
        }
    };

    // Basic ready event
    client.once(Events.ClientReady, async () => {
        console.log(chalk.green(`✅ ${client.user.tag} is online and ready!`));
        console.log(chalk.cyan(`🎵 Music bot serving ${client.guilds.cache.size} servers!`));

        // Set bot activity
        setInterval(() => client.user.setActivity({ name: `${config.bot.status}`, type: ActivityType.Listening }), 10000);
    });

    // Handle interactions (slash commands)
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(chalk.red(`❌ No command matching ${interaction.commandName} was found.`));
            return;
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(chalk.red(`❌ Error executing ${interaction.commandName}:`), error);

            const errorMessage = '❌ An error occurred while executing this command!';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    });

    // Handle voice state updates for auto-disconnect
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
        // Auto-disconnect when bot is alone in voice channel AND not playing music
        if (oldState.channelId && oldState.guild.members.me.voice.channelId === oldState.channelId) {
            const channel = oldState.guild.channels.cache.get(oldState.channelId);
            if (channel && channel.members.filter(m => !m.user.bot).size === 0) {
                // Only bot left in channel, check if music is playing
                const player = client.players.get(oldState.guild.id);

                // If no player or no current track, disconnect after 30 seconds
                if (!player || !player.currentTrack) {
                    setTimeout(() => {
                        // Double-check: still alone AND still no music?
                        const currentChannel = oldState.guild.channels.cache.get(oldState.channelId);
                        const currentPlayer = client.players.get(oldState.guild.id);

                        if (currentChannel &&
                            currentChannel.members.filter(m => !m.user.bot).size === 0 &&
                            (!currentPlayer || !currentPlayer.currentTrack)) {

                            const connection = getVoiceConnection(oldState.guild.id);
                            if (connection && connection.state.status !== 'destroyed') {
                                if (currentPlayer) {
                                    currentPlayer.stop();
                                    client.players.delete(oldState.guild.id);
                                }

                                try {
                                    connection.destroy();
                                } catch (error) {
                                    console.log('🔌 Connection already destroyed');
                                }
                            }
                        } else {
                        }
                    }, 30000);
                } else {
                }
            }
        }
    });

    // Handle process termination
    process.on('SIGINT', () => {

        // Disconnect from all voice channels
        client.players.forEach((player, guildId) => {
            player.stop();
            const connection = getVoiceConnection(guildId);
            if (connection) connection.destroy();
        });

        client.destroy();
        process.exit(0);
    });

    // Error handling
    process.on('unhandledRejection', (reason, promise) => {
        console.error(chalk.red('❌ Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);

        // Discord API error handling
        if (reason && reason.code) {
            switch (reason.code) {
                case 10062: // Unknown interaction
                    console.log(chalk.yellow('ℹ️ Interaction has expired, safely ignoring...'));
                    return;
                case 40060: // Interaction already acknowledged
                    console.log(chalk.yellow('ℹ️ Interaction already acknowledged, safely ignoring...'));
                    return;
                case 50013: // Missing permissions
                    console.error(chalk.red('❌ Missing permissions for Discord action'));
                    return;
            }
        }

        // Voice connection errors
        if (reason && reason.message && reason.message.includes('IP discovery')) {
            // Clean up any voice connections
            client.players.forEach(player => {
                if (player && player.cleanup) {
                    player.cleanup();
                }
            });
            client.players.clear();
            return;
        }
    });

    process.on('uncaughtException', (error) => {
        console.error(chalk.red('❌ Uncaught Exception:'), error);

        // Don't exit on Discord API errors
        if (error.code === 10062 || error.code === 40060) {
            console.log(chalk.yellow('ℹ️ Discord interaction error handled, continuing...'));
            return;
        }

        // For other critical errors, graceful shutdown
        console.log(chalk.red('🛑 Critical error occurred, shutting down...'));

        // Clean up all music players
        if (client && client.players) {
            client.players.forEach(player => {
                if (player && player.cleanup) {
                    player.cleanup();
                }
            });
            client.players.clear();
        }

        process.exit(1);
    });

    // Initialize bot
    const init = async () => {
        try {
            console.log(chalk.blue('🤖 Starting Discord Music Bot...'));

            // Load commands and events
            loadCommands();
            loadEvents();

            // Login to Discord
            await client.login(config.discord.token);

        } catch (error) {
            console.error(chalk.red('❌ Failed to start bot:'), error);
            process.exit(1);
        }
    };

    // Start the bot
    init();

    module.exports = client;
}, 5000);