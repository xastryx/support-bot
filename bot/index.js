/**
 * ASTRYX SUPPORT BOT - STANDALONE VERSION
 * Complete Discord support bot with tickets, moderation, and auto-mod features
 * All code combined into a single file for easy deployment
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js"
import { neon } from "@neondatabase/serverless"

// ==================== CONFIGURATION ====================

const CONFIG = {
  // Bot authentication credentials
  token: process.env.DISCORD_BOT_TOKEN || "",
  clientId: process.env.DISCORD_CLIENT_ID || "",

  // Command prefix (can be changed per-server)
  defaultPrefix: "!",

  // Color scheme for embeds
  colors: {
    primary: 0x5865f2, // Discord Blurple
    success: 0x57f287, // Green
    warning: 0xfee75c, // Yellow
    error: 0xed4245, // Red
  },
}

// ==================== DATABASE CONNECTION ====================

const sql = neon(process.env.POSTGRES_URL)

// Database interface with all CRUD operations
const database = {
  // Get server settings from database
  async getGuildSettings(guildId) {
    const result = await sql`SELECT * FROM guild_settings WHERE guild_id = ${guildId}`
    return result[0] || null
  },

  // Create default settings for new server
  async createGuildSettings(guildId) {
    const result = await sql`
      INSERT INTO guild_settings (guild_id)
      VALUES (${guildId})
      ON CONFLICT (guild_id) DO NOTHING
      RETURNING *
    `
    return result[0]
  },

  // Update server settings
  async updateGuildSettings(guildId, settings) {
    const keys = Object.keys(settings)
    const values = Object.values(settings)
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ")

    const result = await sql(
      `UPDATE guild_settings SET ${setClause}, updated_at = NOW() WHERE guild_id = $1 RETURNING *`,
      [guildId, ...values],
    )
    return result[0]
  },

  // Create new support ticket
  async createTicket(ticketData) {
    const result = await sql`
      INSERT INTO tickets (ticket_id, guild_id, channel_id, user_id, category)
      VALUES (${ticketData.ticketId}, ${ticketData.guildId}, ${ticketData.channelId}, ${ticketData.userId}, ${ticketData.category || null})
      RETURNING *
    `
    return result[0]
  },

  // Get ticket by channel ID
  async getTicketByChannel(channelId) {
    const result = await sql`SELECT * FROM tickets WHERE channel_id = ${channelId} AND status = 'open'`
    return result[0] || null
  },

  // Get all open tickets for a user
  async getUserOpenTickets(guildId, userId) {
    const result = await sql`
      SELECT * FROM tickets 
      WHERE guild_id = ${guildId} AND user_id = ${userId} AND status = 'open'
    `
    return result
  },

  // Close a ticket
  async closeTicket(ticketId, closedBy, transcript) {
    const result = await sql`
      UPDATE tickets 
      SET status = 'closed', closed_at = NOW(), closed_by = ${closedBy}, transcript = ${transcript || null}
      WHERE ticket_id = ${ticketId}
      RETURNING *
    `
    return result[0]
  },

  // Add warning to user
  async addWarning(guildId, userId, moderatorId, reason) {
    const result = await sql`
      INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason})
      RETURNING *
    `
    return result[0]
  },

  // Get user warnings
  async getUserWarnings(guildId, userId) {
    const result = await sql`
      SELECT * FROM warnings 
      WHERE guild_id = ${guildId} AND user_id = ${userId}
      ORDER BY created_at DESC
    `
    return result
  },

  // Clear all warnings for a user
  async clearWarnings(guildId, userId) {
    await sql`DELETE FROM warnings WHERE guild_id = ${guildId} AND user_id = ${userId}`
  },

  // Add mute record
  async addMute(guildId, userId, moderatorId, reason, expiresAt) {
    const result = await sql`
      INSERT INTO mutes (guild_id, user_id, moderator_id, reason, expires_at)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason}, ${expiresAt || null})
      RETURNING *
    `
    return result[0]
  },

  // Remove active mute
  async removeMute(guildId, userId) {
    await sql`
      UPDATE mutes 
      SET active = false 
      WHERE guild_id = ${guildId} AND user_id = ${userId} AND active = true
    `
  },

  // Get all active mutes for expiration checking
  async getActiveMutes(guildId) {
    const result = await sql`SELECT * FROM mutes WHERE guild_id = ${guildId} AND active = true`
    return result
  },

  // Record ban in database
  async addBan(guildId, userId, moderatorId, reason) {
    const result = await sql`
      INSERT INTO bans (guild_id, user_id, moderator_id, reason)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason})
      RETURNING *
    `
    return result[0]
  },

  // Log auto-moderation action
  async logAutoMod(guildId, userId, action, reason) {
    await sql`
      INSERT INTO automod_logs (guild_id, user_id, action, reason)
      VALUES (${guildId}, ${userId}, ${action}, ${reason})
    `
  },
}

// ==================== TICKET SYSTEM ====================

const ticketSystem = {
  // Create new support ticket channel
  async createTicket(interaction) {
    await interaction.deferReply({ ephemeral: true })

    const guild = interaction.guild
    const settings = await database.getGuildSettings(guild.id)

    // Check for existing open tickets
    const existingTickets = await database.getUserOpenTickets(guild.id, interaction.user.id)
    if (existingTickets.length > 0) {
      await interaction.editReply({ content: "You already have an open ticket." })
      return
    }

    try {
      // Generate unique ticket ID
      const ticketNumber = Math.floor(Math.random() * 10000)
      const ticketId = `ticket-${ticketNumber}`

      // Create private channel for ticket
      const channel = await guild.channels.create({
        name: `ticket-${interaction.user.username}-${ticketNumber}`,
        type: ChannelType.GuildText,
        parent: settings?.ticket_category_id || undefined,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      })

      // Add support role permissions if configured
      if (settings?.support_role_id) {
        await channel.permissionOverwrites.create(settings.support_role_id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        })
      }

      // Save ticket to database
      await database.createTicket({
        ticketId,
        guildId: guild.id,
        channelId: channel.id,
        userId: interaction.user.id,
      })

      // Send welcome message with close button
      const embed = new EmbedBuilder()
        .setTitle("Support Ticket")
        .setDescription("Thank you for creating a ticket. Our support team will be with you shortly.")
        .setColor(CONFIG.colors.primary)
        .addFields(
          { name: "Created by", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Ticket ID", value: ticketId, inline: true },
        )
        .setTimestamp()

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger),
      )

      await channel.send({ embeds: [embed], components: [row] })
      await interaction.editReply({ content: `Ticket created: <#${channel.id}>` })

      // Log ticket creation
      if (settings?.ticket_log_channel_id) {
        const logChannel = guild.channels.cache.get(settings.ticket_log_channel_id)
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle("Ticket Created")
            .setColor(CONFIG.colors.success)
            .addFields(
              { name: "User", value: `<@${interaction.user.id}>`, inline: true },
              { name: "Ticket", value: `<#${channel.id}>`, inline: true },
              { name: "Ticket ID", value: ticketId, inline: true },
            )
            .setTimestamp()

          await logChannel.send({ embeds: [logEmbed] })
        }
      }
    } catch (error) {
      console.error("Error creating ticket:", error)
      await interaction.editReply({ content: "An error occurred while creating the ticket." })
    }
  },

  // Close existing ticket
  async closeTicket(interaction) {
    await interaction.deferReply()

    const channel = interaction.channel
    const ticket = await database.getTicketByChannel(channel.id)

    if (!ticket) {
      await interaction.editReply({ content: "This is not a valid ticket channel." })
      return
    }

    // Generate transcript from recent messages
    const messages = await channel.messages.fetch({ limit: 100 })
    const transcript = messages
      .reverse()
      .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
      .join("\n")

    // Update database
    await database.closeTicket(ticket.ticket_id, interaction.user.id, transcript)

    // Send closure notification
    const embed = new EmbedBuilder()
      .setTitle("Ticket Closed")
      .setDescription("This ticket has been closed. The channel will be deleted in 5 seconds.")
      .setColor(CONFIG.colors.error)
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })

    // Log closure
    const settings = await database.getGuildSettings(interaction.guild.id)
    if (settings?.ticket_log_channel_id) {
      const logChannel = interaction.guild.channels.cache.get(settings.ticket_log_channel_id)
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle("Ticket Closed")
          .setColor(CONFIG.colors.error)
          .addFields(
            { name: "Ticket", value: channel.name, inline: true },
            { name: "Closed by", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Ticket ID", value: ticket.ticket_id, inline: true },
          )
          .setTimestamp()

        await logChannel.send({ embeds: [logEmbed] })
      }
    }

    // Delete channel after delay
    setTimeout(async () => {
      try {
        await channel.delete()
      } catch (error) {
        console.error("Error deleting ticket channel:", error)
      }
    }, 5000)
  },
}

// ==================== MODERATION COMMANDS ====================

const moderationCommands = {
  // Handle all moderation commands
  async handleCommand(message, command, args) {
    const settings = await database.getGuildSettings(message.guild.id)

    const commands = {
      warn: () => this.warn(message, args, settings),
      warnings: () => this.getWarnings(message, args),
      clearwarnings: () => this.clearWarnings(message, args),
      mute: () => this.mute(message, args, settings),
      unmute: () => this.unmute(message, args, settings),
      kick: () => this.kick(message, args, settings),
      ban: () => this.ban(message, args, settings),
      unban: () => this.unban(message, args),
      purge: () => this.purge(message, args),
      setprefix: () => this.setPrefix(message, args),
      setup: () => this.setup(message),
      help: () => this.help(message),
    }

    if (commands[command]) {
      await commands[command]()
    }
  },

  // Warn a user
  async warn(message, args, settings) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const user = message.mentions.users.first()
    if (!user) {
      await message.reply("Please mention a user to warn.")
      return
    }

    const reason = args.slice(1).join(" ") || "No reason provided"
    await database.addWarning(message.guild.id, user.id, message.author.id, reason)

    const embed = new EmbedBuilder()
      .setTitle("User Warned")
      .setColor(CONFIG.colors.warning)
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
        { name: "Reason", value: reason },
      )
      .setTimestamp()

    await message.reply({ embeds: [embed] })

    if (settings?.mod_log_channel_id) {
      const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
      if (logChannel) await logChannel.send({ embeds: [embed] })
    }
  },

  // View user warnings
  async getWarnings(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const user = message.mentions.users.first()
    if (!user) {
      await message.reply("Please mention a user to view warnings.")
      return
    }

    const warnings = await database.getUserWarnings(message.guild.id, user.id)

    if (warnings.length === 0) {
      await message.reply(`<@${user.id}> has no warnings.`)
      return
    }

    const embed = new EmbedBuilder()
      .setTitle(`Warnings for ${user.tag}`)
      .setColor(CONFIG.colors.warning)
      .setDescription(
        warnings
          .map(
            (w, i) =>
              `**${i + 1}.** ${w.reason}\n*By <@${w.moderator_id}> on ${new Date(w.created_at).toLocaleDateString()}*`,
          )
          .join("\n\n"),
      )
      .setTimestamp()

    await message.reply({ embeds: [embed] })
  },

  // Clear user warnings
  async clearWarnings(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const user = message.mentions.users.first()
    if (!user) {
      await message.reply("Please mention a user to clear warnings.")
      return
    }

    await database.clearWarnings(message.guild.id, user.id)
    await message.reply(`Cleared all warnings for <@${user.id}>.`)
  },

  // Mute a user
  async mute(message, args, settings) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to mute.")
      return
    }

    const durationStr = args[1]
    const reason = args.slice(2).join(" ") || "No reason provided"

    let duration = 0
    let expiresAt = undefined

    if (durationStr) {
      const match = durationStr.match(/^(\d+)([mhd])$/)
      if (match) {
        const value = Number.parseInt(match[1])
        const unit = match[2]

        if (unit === "m") duration = value * 60 * 1000
        else if (unit === "h") duration = value * 60 * 60 * 1000
        else if (unit === "d") duration = value * 24 * 60 * 60 * 1000

        expiresAt = new Date(Date.now() + duration)
      }
    }

    try {
      await member.timeout(duration || 28 * 24 * 60 * 60 * 1000, reason)
      await database.addMute(message.guild.id, member.id, message.author.id, reason, expiresAt)

      const embed = new EmbedBuilder()
        .setTitle("User Muted")
        .setColor(CONFIG.colors.warning)
        .addFields(
          { name: "User", value: `<@${member.id}>`, inline: true },
          { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
          { name: "Duration", value: durationStr || "Permanent", inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()

      await message.reply({ embeds: [embed] })

      if (settings?.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) await logChannel.send({ embeds: [embed] })
      }
    } catch (error) {
      await message.reply("Failed to mute user.")
    }
  },

  // Unmute a user
  async unmute(message, args, settings) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to unmute.")
      return
    }

    try {
      await member.timeout(null)
      await database.removeMute(message.guild.id, member.id)
      await message.reply(`Unmuted <@${member.id}>.`)

      if (settings?.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle("User Unmuted")
            .setColor(CONFIG.colors.success)
            .addFields(
              { name: "User", value: `<@${member.id}>`, inline: true },
              { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
            )
            .setTimestamp()

          await logChannel.send({ embeds: [embed] })
        }
      }
    } catch (error) {
      await message.reply("Failed to unmute user.")
    }
  },

  // Kick a user
  async kick(message, args, settings) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to kick.")
      return
    }

    const reason = args.slice(1).join(" ") || "No reason provided"

    try {
      await member.kick(reason)

      const embed = new EmbedBuilder()
        .setTitle("User Kicked")
        .setColor(CONFIG.colors.error)
        .addFields(
          { name: "User", value: `<@${member.id}>`, inline: true },
          { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()

      await message.reply({ embeds: [embed] })

      if (settings?.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) await logChannel.send({ embeds: [embed] })
      }
    } catch (error) {
      await message.reply("Failed to kick user.")
    }
  },

  // Ban a user
  async ban(message, args, settings) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to ban.")
      return
    }

    const reason = args.slice(1).join(" ") || "No reason provided"

    try {
      await member.ban({ reason })
      await database.addBan(message.guild.id, member.id, message.author.id, reason)

      const embed = new EmbedBuilder()
        .setTitle("User Banned")
        .setColor(CONFIG.colors.error)
        .addFields(
          { name: "User", value: `<@${member.id}>`, inline: true },
          { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()

      await message.reply({ embeds: [embed] })

      if (settings?.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) await logChannel.send({ embeds: [embed] })
      }
    } catch (error) {
      await message.reply("Failed to ban user.")
    }
  },

  // Unban a user
  async unban(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const userId = args[0]
    if (!userId) {
      await message.reply("Please provide a user ID to unban.")
      return
    }

    try {
      await message.guild.members.unban(userId)
      await message.reply(`Unbanned user with ID: ${userId}`)
    } catch (error) {
      await message.reply("Failed to unban user.")
    }
  },

  // Purge messages
  async purge(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const amount = Number.parseInt(args[0])
    if (isNaN(amount) || amount < 1 || amount > 100) {
      await message.reply("Please provide a number between 1 and 100.")
      return
    }

    try {
      const deleted = await message.channel.bulkDelete(amount + 1, true)
      const reply = await message.channel.send(`Deleted ${deleted.size - 1} messages.`)
      setTimeout(() => reply.delete(), 3000)
    } catch (error) {
      await message.reply("Failed to delete messages.")
    }
  },

  // Set command prefix
  async setPrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const newPrefix = args[0]
    if (!newPrefix) {
      await message.reply("Please provide a new prefix.")
      return
    }

    await database.updateGuildSettings(message.guild.id, { prefix: newPrefix })
    await message.reply(`Prefix updated to: ${newPrefix}`)
  },

  // Setup command
  async setup(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const embed = new EmbedBuilder()
      .setTitle("Bot Setup Commands")
      .setColor(CONFIG.colors.primary)
      .setDescription("Use these commands to configure the bot:")
      .addFields(
        { name: "Prefix", value: "`!setprefix <prefix>` - Change the command prefix" },
        {
          name: "Manual Setup",
          value: "Configure channels and roles through Discord server settings and use their IDs with the database.",
        },
      )

    await message.reply({ embeds: [embed] })
  },

  // Help command
  async help(message) {
    const embed = new EmbedBuilder()
      .setTitle("Astryx Support - Help")
      .setColor(CONFIG.colors.primary)
      .setDescription("Here are all available commands:")
      .addFields(
        {
          name: "Moderation",
          value: "`warn`, `warnings`, `clearwarnings`, `mute`, `unmute`, `kick`, `ban`, `unban`, `purge`",
        },
        { name: "Configuration", value: "`setprefix`, `setup`" },
        { name: "Tickets", value: "Use the ticket button to create tickets" },
      )
      .setFooter({ text: "Astryx Support Bot" })
      .setTimestamp()

    await message.reply({ embeds: [embed] })
  },
}

// ==================== AUTO-MODERATION ====================

const autoModeration = {
  // In-memory message cache for spam detection
  messageCache: new Map(),

  // Check message for violations
  async checkMessage(message, settings) {
    // Check spam
    if (await this.checkSpam(message, settings)) return

    // Check excessive caps
    if (this.checkCaps(message, settings)) {
      await this.handleViolation(message, "Excessive caps usage", settings)
      return
    }

    // Check unauthorized links
    if (settings.auto_mod_links_enabled && this.checkLinks(message)) {
      await this.handleViolation(message, "Unauthorized link posting", settings)
      return
    }
  },

  // Detect spam by message frequency
  async checkSpam(message, settings) {
    const userId = message.author.id
    const now = Date.now()
    const timeWindow = 5000 // 5 seconds

    let userData = this.messageCache.get(userId)
    if (!userData) {
      userData = { count: 0, timestamps: [] }
      this.messageCache.set(userId, userData)
    }

    // Remove old timestamps outside window
    userData.timestamps = userData.timestamps.filter((ts) => now - ts < timeWindow)
    userData.timestamps.push(now)
    userData.count = userData.timestamps.length

    // Check if spam limit exceeded
    if (userData.count >= settings.auto_mod_spam_limit) {
      await this.handleViolation(message, "Spam detected", settings)
      userData.timestamps = []
      userData.count = 0
      return true
    }

    return false
  },

  // Check for excessive caps
  checkCaps(message, settings) {
    const text = message.content
    if (text.length < 5) return false

    const capsCount = (text.match(/[A-Z]/g) || []).length
    const capsPercent = (capsCount / text.length) * 100

    return capsPercent >= settings.auto_mod_caps_percent
  },

  // Check for URLs
  checkLinks(message) {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return urlRegex.test(message.content)
  },

  // Handle auto-mod violation
  async handleViolation(message, reason, settings) {
    try {
      await message.delete()
      await database.logAutoMod(message.guild.id, message.author.id, "delete", reason)

      const warningEmbed = new EmbedBuilder()
        .setTitle("Auto-Moderation")
        .setDescription(`<@${message.author.id}>, your message was deleted: ${reason}`)
        .setColor(CONFIG.colors.warning)
        .setTimestamp()

      const warning = await message.channel.send({ embeds: [warningEmbed] })
      setTimeout(() => warning.delete(), 5000)

      // Log to mod channel
      if (settings.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle("Auto-Mod Action")
            .setColor(CONFIG.colors.warning)
            .addFields(
              { name: "User", value: `<@${message.author.id}>`, inline: true },
              { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
              { name: "Reason", value: reason, inline: true },
              { name: "Message", value: message.content.substring(0, 1000) },
            )
            .setTimestamp()

          await logChannel.send({ embeds: [logEmbed] })
        }
      }
    } catch (error) {
      console.error("Error handling auto-mod violation:", error)
    }
  },
}

// ==================== DISCORD CLIENT INITIALIZATION ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
})

// Bot ready event
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`)

  // Start mute expiration checker (runs every minute)
  setInterval(async () => {
    const guilds = client.guilds.cache

    for (const [guildId, guild] of guilds) {
      const mutes = await database.getActiveMutes(guildId)

      for (const mute of mutes) {
        if (mute.expires_at && new Date(mute.expires_at) <= new Date()) {
          try {
            const member = await guild.members.fetch(mute.user_id)
            await member.timeout(null)
            await database.removeMute(guildId, mute.user_id)
          } catch (error) {
            console.error("Error unmuting user:", error)
          }
        }
      }
    }
  }, 60000)
})

// Guild join event
client.on(Events.GuildCreate, async (guild) => {
  await database.createGuildSettings(guild.id)
})

// Message creation event
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return

  const settings = await database.getGuildSettings(message.guild.id)
  if (!settings) {
    await database.createGuildSettings(message.guild.id)
  }

  // Run auto-moderation checks
  if (settings?.auto_mod_enabled) {
    await autoModeration.checkMessage(message, settings)
  }

  // Check for commands
  const prefix = settings?.prefix || CONFIG.defaultPrefix
  if (!message.content.startsWith(prefix)) return

  const args = message.content.slice(prefix.length).trim().split(/ +/)
  const command = args.shift()?.toLowerCase()

  if (!command) return

  await moderationCommands.handleCommand(message, command, args)
})

// Button interaction event
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === "create_ticket") {
      await ticketSystem.createTicket(interaction)
    } else if (interaction.customId === "close_ticket") {
      await ticketSystem.closeTicket(interaction)
    }
  }
})

// Login to Discord
client.login(CONFIG.token)

