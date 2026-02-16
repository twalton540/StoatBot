import { Client } from "stoat.js";
import 'dotenv/config';

const STOAT_TOKEN = process.env.STOAT_TOKEN;
const STOAT_CHANNEL_ID = process.env.STOAT_CHANNEL_ID;

const client = new Client();

const stoatClient = {
    client: client,
    channelId: STOAT_CHANNEL_ID,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

    init: () => {
        return new Promise((resolve, reject) => {
            client.on("ready", async () => {
                console.info(`Stoat logged in as ${client.user.username}!`);
                console.info(`Using timezone: ${stoatClient.timezone}`);
                resolve(client);
            });

            client.on("error", (error) => {
                reject(error);
            });

            client.loginBot(STOAT_TOKEN);
        });
    },

    reconnect: async () => {
        console.log('Attempting to reconnect to Stoat...');

        // Create a new client instance
        const newClient = new Client();

        return new Promise((resolve, reject) => {
            newClient.on("ready", async () => {
                console.info(`Stoat reconnected as ${newClient.user.username}!`);
                // Replace the old client with the new one
                stoatClient.client = newClient;
                resolve(newClient);
            });

            newClient.on("error", (error) => {
                reject(error);
            });

            newClient.loginBot(STOAT_TOKEN);
        });
    },

    setTimezone: (tz) => {
        stoatClient.timezone = tz;
        console.info(`Timezone set to: ${stoatClient.timezone}`);
    },

    getChannel: () => {
        return stoatClient.client.channels.get(STOAT_CHANNEL_ID);
    },

    replaceCustomEmojis: (content) => {
        return content.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
            return `https://cdn.discordapp.com/emojis/${id}.webp?size=96`;
        });
    },

    sendDiscordMessage: async (discordMsg, replyToStoatId = null, includeTimestamp = true, replaceMentionsFn) => {
        const channel = stoatClient.getChannel();

        let content = discordMsg.Content || '';

        content = stoatClient.replaceCustomEmojis(content);

        if (replaceMentionsFn) {
            content = replaceMentionsFn(content);
        }

        if (includeTimestamp) {
            const timestamp = discordMsg.Timestamp.toLocaleString('en-US', {
                timeZone: stoatClient.timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            content = `(${timestamp})\n${content}`;
        }

        if (discordMsg.Attachments && discordMsg.Attachments.length > 0) {
            content += '\n\n**Attachments:**';
            discordMsg.Attachments.forEach(att => {
                content += `\n[${att.Filename}](${att.Url})`;
            });
        }

        content = content.trim();
        if (!content || content.length === 0) {
            content = '(no content)';
        }
        if (content.length > 2000) {
            content = content.substring(0, 1997) + '...';
        }

        const masquerade = {
            name: discordMsg.Author
        };

        if (discordMsg.AvatarUrl) {
            masquerade.avatar = discordMsg.AvatarUrl;
        }

        if (discordMsg.RoleColor) {
            masquerade.colour = discordMsg.RoleColor;
        }

        const payload = {
            content: content,
            masquerade: masquerade
        };

        if (replyToStoatId) {
            payload.replies = [{
                id: replyToStoatId,
                mention: false
            }];
        }

        if (discordMsg.Embeds && discordMsg.Embeds.length > 0) {
            payload.embeds = discordMsg.Embeds.map(embed => {
                let description = embed.Description || null;

                if (embed.ImageUrl) {
                    description = description
                        ? `${description}\n\n[Image](${embed.ImageUrl})`
                        : `[Image](${embed.ImageUrl})`;
                }

                let processedEmbed = {
                    title: embed.Title || null,
                    description: description,
                    url: embed.Url && embed.Url.length <= 256 ? embed.Url : null,
                    icon_url: embed.ThumbnailUrl || null
                };

                if (processedEmbed.title) {
                    processedEmbed.title = stoatClient.replaceCustomEmojis(processedEmbed.title);
                    if (replaceMentionsFn) {
                        processedEmbed.title = replaceMentionsFn(processedEmbed.title);
                    }
                }

                if (processedEmbed.description) {
                    processedEmbed.description = stoatClient.replaceCustomEmojis(processedEmbed.description);
                    if (replaceMentionsFn) {
                        processedEmbed.description = replaceMentionsFn(processedEmbed.description);
                    }
                }

                return processedEmbed;
            }).filter(e => {
                return e.title || e.description || e.url;
            });
        }

        if (discordMsg.Reactions && discordMsg.Reactions.length > 0) {
            payload.interactions = {
                reactions: discordMsg.Reactions.map(r => r.Emoji),
                restrict_reactions: false
            };
        }

        const sentMessage = await channel.sendMessage(payload);

        return sentMessage;
    }
};

export default stoatClient;