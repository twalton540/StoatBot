import { Client as DiscordClient, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const dc = new DiscordClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers  // Need this for role colors
    ]
});

const discordClient = {
    client: dc,
    guildId: DISCORD_GUILD_ID,
    channelId: DISCORD_CHANNEL_ID,
    userCache: new Map(), // Cache for user info

    init: () => {
        return new Promise((resolve, reject) => {
            dc.once('ready', async () => {
                console.log('Discord client ready!');
                resolve(dc);
            });

            dc.on('error', (error) => {
                reject(error);
            });

            dc.login(DISCORD_TOKEN);
        });
    },

    getChannel: async () => {
        const guild = await dc.guilds.fetch(DISCORD_GUILD_ID);
        return await guild.channels.fetch(DISCORD_CHANNEL_ID);
    },

    getUserRoleColor: async (member) => {
        if (!member) return null;

        // Get the highest role with a color
        const colorRole = member.roles.cache
            .filter(role => role.color !== 0)
            .sort((a, b) => b.position - a.position)
            .first();

        if (!colorRole) return null;

        // Convert Discord's integer color to hex
        const hexColor = colorRole.color.toString(16).padStart(6, '0');
        return `#${hexColor}`;
    },

    buildUserCache: async () => {
        console.log('Building user cache...');
        const guild = await dc.guilds.fetch(DISCORD_GUILD_ID);

        // Fetch all members
        const members = await guild.members.fetch();

        members.forEach(member => {
            discordClient.userCache.set(member.user.id, {
                username: member.displayName || member.user.username, // Use displayName here
                displayName: member.displayName || member.user.username,
                id: member.user.id
            });
        });

        console.log(`Cached ${discordClient.userCache.size} users`);
    },

    replaceMentions: (content) => {
        // Replace user mentions <@123456789> with @username
        return content.replace(/<@!?(\d+)>/g, (match, userId) => {
            const user = discordClient.userCache.get(userId);
            if (user) {
                return `@${user.username}`;
            }
            return match; // Keep original if user not found
        });
    },

    fetchAllMessages: async (limit = null, lastProcessedMessageId = null) => {
        const channel = await discordClient.getChannel();
        const guild = await dc.guilds.fetch(DISCORD_GUILD_ID);

        console.log(`Fetching messages from #${channel.name}...`);
        if (lastProcessedMessageId) {
            console.log(`Will stop fetching when we reach: ${lastProcessedMessageId}`);
        }

        const allMessages = [];
        let lastMessageId = null;
        let fetchCount = 0;

        while (true) {
            const options = { limit: 100 };
            if (lastMessageId) {
                options.before = lastMessageId;
            }

            const messages = await channel.messages.fetch(options);

            if (messages.size === 0) break;

            for (const [id, msg] of messages) {
                // Stop fetching if we've reached the last processed message
                if (lastProcessedMessageId && msg.id === lastProcessedMessageId) {
                    console.log('Reached last processed message, stopping fetch');
                    return allMessages.reverse(); // Return what we have so far
                }

                // Get member for role color
                let member = null;
                let roleColor = null;
                try {
                    member = await guild.members.fetch(msg.author.id);
                    roleColor = await discordClient.getUserRoleColor(member);

                    // Add to cache if not already there
                    if (!discordClient.userCache.has(msg.author.id)) {
                        discordClient.userCache.set(msg.author.id, {
                            username: member.displayName || msg.author.username,
                            displayName: member.displayName || msg.author.username,
                            id: msg.author.id
                        });
                    }
                } catch (error) {
                    console.warn(`Could not fetch member info for ${msg.author.username}`);
                }

                // Get user avatar URL (prefer guild avatar, fallback to global avatar)
                const avatarUrl = msg.author.displayAvatarURL({
                    extension: 'png',
                    size: 256
                });

                const exportMsg = {
                    Id: msg.id,
                    Timestamp: msg.createdAt,
                    Author: member?.displayName || msg.author.username,
                    AvatarUrl: avatarUrl,
                    RoleColor: roleColor,
                    Content: msg.content,
                    Attachments: msg.attachments.map(att => ({
                        Url: att.url,
                        Filename: att.name
                    })),
                    Embeds: msg.embeds.map(embed => ({
                        Title: embed.title,
                        Description: embed.description,
                        Url: embed.url,
                        ImageUrl: embed.image?.url,
                        ThumbnailUrl: embed.thumbnail?.url
                    })),
                    Reactions: msg.reactions.cache.map(reaction => ({
                        Emoji: reaction.emoji.name,
                        Count: reaction.count
                    })),
                    ReplyTo: msg.reference ? {
                        MessageId: msg.reference.messageId
                    } : null
                };

                allMessages.push(exportMsg);
                fetchCount++;
            }

            lastMessageId = messages.last().id;
            console.log(`Fetched ${fetchCount} messages...`);

            // Check limit
            if (limit && fetchCount >= limit) {
                break;
            }

            // Rate limit protection
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Build message dictionary for reply authors
        const messageDict = new Map();
        allMessages.forEach(msg => {
            messageDict.set(msg.Id, msg.Author);
        });

        // Add reply author names
        allMessages.forEach(msg => {
            if (msg.ReplyTo && messageDict.has(msg.ReplyTo.MessageId)) {
                msg.ReplyTo.Author = messageDict.get(msg.ReplyTo.MessageId);
            }
        });

        // Reverse to chronological order (oldest first)
        allMessages.reverse();

        return allMessages;
    }
};

export default discordClient;