/**
 * Main Discord Bot Entry Point
 * Initializes the Discord client, sets up event handlers, and manages bot lifecycle
 */
import { Client, GatewayIntentBits, Events } from "discord.js"
import { config } from "./config"
import { db } from "./database"
import { ticketHandler } from "./handlers/ticket-handler"
import { moderationHandler } from "./handlers/moderation-handler"
import { autoModHandler } from "./handlers/automod-handler"

// Initialize Discord client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // Access to guild/server information
    GatewayIntentBits.GuildMessages, // Read messages in guilds
    GatewayIntentBits.GuildMembers, // Access to member information
    GatewayIntentBits.MessageContent, // Access to message content (privileged)
    GatewayIntentBits.GuildModeration, // Access to moderation events (bans, kicks)
  ],
})

// Bot ready event - fires once when bot successfully connects to Discord
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`)

  // Start automatic mute expiration checker
  // Runs every minute to check for expired temporary mutes
  setInterval(async () => {
    const guilds = client.guilds.cache

    // Loop through all guilds the bot is in
    for (const [guildId, guild] of guilds) {
      const mutes = await db.getActiveMutes(guildId)

      // Check each active mute for expiration
      for (const mute of mutes) {
        if (mute.expires_at && new Date(mute.expires_at) <= new Date()) {
          try {
            // Remove Discord timeout and update database
            const member = await guild.members.fetch(mute.user_id)
            await member.timeout(null)
            await db.removeMute(guildId, mute.user_id)
          } catch (error) {
            console.error("Error unmuting user:", error)
          }
        }
      }
    }
  }, 60000) // Check every 60 seconds
})

// Guild join event - fires when bot is added to a new server
client.on(Events.GuildCreate, async (guild) => {
  // Initialize default settings for new guild
  await db.createGuildSettings(guild.id)
})

// Message creation event - fires whenever a message is sent in any channel the bot can see
client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots to prevent loops
  if (message.author.bot) return

  // Get or create guild settings
  const settings = await db.getGuildSettings(message.guild.id)
  if (!settings) {
    await db.createGuildSettings(message.guild.id)
  }

  // Run auto-moderation checks if enabled
  if (settings?.auto_mod_enabled) {
    await autoModHandler.checkMessage(message, settings)
  }

  // Check if message starts with command prefix
  const prefix = settings?.prefix || config.defaultPrefix
  if (!message.content.startsWith(prefix)) return

  // Parse command and arguments
  const args = message.content.slice(prefix.length).trim().split(/ +/)
  const command = args.shift()?.toLowerCase()

  if (!command) return

  // Route to moderation command handler
  await moderationHandler.handleCommand(message, command, args)
})

// Interaction event - handles button clicks and slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    // Route button interactions to ticket handler
    await ticketHandler.handleButton(interaction)
  }
})

// Login to Discord with bot token
client.login(config.token)

export { client }
