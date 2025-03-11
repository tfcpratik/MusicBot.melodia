const config = require('./config.js');

if (config.shardManager.shardStatus === true) {
    const { ShardingManager } = require('discord.js');
    const primaryToken = config.TOKENS[0] || process.env.TOKEN;
    const manager = new ShardingManager('./bot.js', { token: primaryToken });
    manager.on('shardCreate', shard => console.log(`Launched shard ${shard.id}`));
    manager.spawn();
} else {
    const tokens = (config.TOKENS && config.TOKENS.length) ? config.TOKENS : [process.env.TOKEN];
    tokens.forEach(token => {
        require("./bot.js")(token);
    });
}
