/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ASTRYX SUPPORT BOT - COMPLETE STANDALONE VERSION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A comprehensive Discord support bot featuring:
 * - Support ticket system with channel creation/management
 * - Advanced moderation (warn, mute, kick, ban, unban)
 * - Auto-moderation for spam, caps, links
 * - Complete logging and audit trails
 * - Per-server configuration
 *
 * All functionality is contained in this single file for easy deployment.
 * Environment variables required:
 *   - DISCORD_BOT_TOKEN: Your Discord bot token from Developer Portal
 *   - DISCORD_CLIENT_ID: Your Discord application ID
 *   - POSTGRES_URL: Neon database connection string
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS & DEPENDENCIES
// ═══════════════════════════════════════════════════════════════════════════
// Discord.js provides all Discord API interactions and event handlers
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

// Neon provides serverless PostgreSQL database access for data persistence
import { neon } from "@neondatabase/serverless"

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION OBJECT
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Bot authentication credentials from environment variables
  // These must be set in your hosting environment's secrets
  token: process.env.DISCORD_BOT_TOKEN || "",
  clientId: process.env.DISCORD_CLIENT_ID || "",

  // Default command prefix (can be overridden per-server in database)
  defaultPrefix: "!",

  // Color scheme for all embed messages - matches Discord's design language
  colors: {
    primary: 0x5865f2, // Discord Blurple - used for informational messages
    success: 0x57f287, // Green - used for successful actions
    warning: 0xfee75c, // Yellow - used for warnings and cautions
    error: 0xed4245, // Red - used for errors and destructive actions
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE INITIALIZATION & CONNECTION
// ═══════════════════════════════════════════════════════════════════════════

// Create SQL query function - all database operations use this
const sql = neon(process.env.POSTGRES_URL)

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS OBJECT
// ═══════════════════════════════════════════════════════════════════════════

const database = {
  /**
   * GUILD SETTINGS OPERATIONS
   * ─────────────────────────────────────────────────────────────────────────
   * Manage per-server configuration like channels, roles, prefixes
   */

  // Retrieve all settings for a specific server
  // Returns null if server not configured, otherwise returns settings object
  async getGuildSettings(guildId) {
    const result = await sql`SELECT * FROM guild_settings WHERE guild_id = ${guildId}`
    return result[0] || null
  },

  // Initialize default settings for a new server in the database
  // Uses INSERT ... ON CONFLICT to prevent duplicate entries
  // RETURNING clause retrieves the created record
  async createGuildSettings(guildId) {
    const result = await sql`
      INSERT INTO guild_settings (guild_id)
      VALUES (${guildId})
      ON CONFLICT (guild_id) DO NOTHING
      RETURNING *
    `
    return result[0]
  },

  // Update any settings field for a server
  // Dynamically builds SQL SET clause from provided settings object
  // Updates the updated_at timestamp automatically
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

  /**
   * TICKET OPERATIONS
   * ─────────────────────────────────────────────────────────────────────────
   * Create, retrieve, and manage support tickets
   */

  // Create a new support ticket entry in database
  // Stores user info, channel ID, and ticket metadata
  async createTicket(ticketData) {
    const result = await sql`
      INSERT INTO tickets (ticket_id, guild_id, channel_id, user_id, category)
      VALUES (${ticketData.ticketId}, ${ticketData.guildId}, ${ticketData.channelId}, ${ticketData.userId}, ${ticketData.category || null})
      RETURNING *
    `
    return result[0]
  },

  // Find an open ticket by its Discord channel ID
  // Used when processing ticket button clicks or channel messages
  // Only returns tickets with status 'open'
  async getTicketByChannel(channelId) {
    const result = await sql`SELECT * FROM tickets WHERE channel_id = ${channelId} AND status = 'open'`
    return result[0] || null
  },

  // Retrieve all open tickets created by a user in a specific server
  // Prevents users from creating multiple concurrent tickets
  async getUserOpenTickets(guildId, userId) {
    const result = await sql`
      SELECT * FROM tickets 
      WHERE guild_id = ${guildId} AND user_id = ${userId} AND status = 'open'
    `
    return result
  },

  // Close a ticket and save the transcript (conversation history)
  // Sets status to 'closed' and records who closed it and when
  async closeTicket(ticketId, closedBy, transcript) {
    const result = await sql`
      UPDATE tickets 
      SET status = 'closed', closed_at = NOW(), closed_by = ${closedBy}, transcript = ${transcript || null}
      WHERE ticket_id = ${ticketId}
      RETURNING *
    `
    return result[0]
  },

  /**
   * WARNING OPERATIONS
   * ─────────────────────────────────────────────────────────────────────────
   * Track user warnings for moderation purposes
   */

  // Add a warning to a user's record
  // Each warning stores the reason, moderator who issued it, and timestamp
  async addWarning(guildId, userId, moderatorId, reason) {
    const result = await sql`
      INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason})
      RETURNING *
    `
    return result[0]
  },

  // Retrieve all warnings for a user in a specific server
  // Ordered by most recent first for easy viewing
  async getUserWarnings(guildId, userId) {
    const result = await sql`
      SELECT * FROM warnings 
      WHERE guild_id = ${guildId} AND user_id = ${userId}
      ORDER BY created_at DESC
    `
    return result
  },

  // Remove all warnings for a user (admin cleanup)
  // Typically used when moderators decide to give a user a fresh start
  async clearWarnings(guildId, userId) {
    await sql`DELETE FROM warnings WHERE guild_id = ${guildId} AND user_id = ${userId}`
  },

  /**
   * MUTE OPERATIONS
   * ─────────────────────────────────────────────────────────────────────────
   * Track temporary and permanent mutes
   */

  // Record a mute action in the database
  // Can be temporary (expires_at set) or permanent (expires_at null)
  async addMute(guildId, userId, moderatorId, reason, expiresAt) {
    const result = await sql`
      INSERT INTO mutes (guild_id, user_id, moderator_id, reason, expires_at)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason}, ${expiresAt || null})
      RETURNING *
    `
    return result[0]
  },

  // Mark a mute as inactive (when user is unmuted)
  // Keeps historical record while marking as no longer active
  async removeMute(guildId, userId) {
    await sql`
      UPDATE mutes 
      SET active = false 
      WHERE guild_id = ${guildId} AND user_id = ${userId} AND active = true
    `
  },

  // Get all currently active mutes for a server
  // Used for checking expiration times and managing active mutes
  async getActiveMutes(guildId) {
    const result = await sql`SELECT * FROM mutes WHERE guild_id = ${guildId} AND active = true`
    return result
  },

  /**
   * BAN OPERATIONS
   * ─────────────────────────────────────────────────────────────────────────
   * Record bans for audit trail and statistics
   */

  // Record a ban in the database
  // Creates permanent audit record of who was banned, by whom, and why
  async addBan(guildId, userId, moderatorId, reason) {
    const result = await sql`
      INSERT INTO bans (guild_id, user_id, moderator_id, reason)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason})
      RETURNING *
    `
    return result[0]
  },

  /**
   * AUTO-MODERATION OPERATIONS
   * ─────────────────────────────────────────────────────────────────────────
   * Log automated moderation actions
   */

  // Log any auto-moderation action taken by the bot
  // Creates audit trail for review and statistics
  async logAutoMod(guildId, userId, action, reason) {
    await sql`
      INSERT INTO automod_logs (guild_id, user_id, action, reason)
      VALUES (${guildId}, ${userId}, ${action}, ${reason})
    `
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKET SYSTEM HANDLER
// ═══════════════════════════════════════════════════════════════════════════

const ticketSystem = {
  /**
   * CREATE NEW SUPPORT TICKET
   * ─────────────────────────────────────────────────────────────────────────
   * Creates a private Discord channel for user-to-support conversation
   */
  async createTicket(interaction) {
    // Defer reply as ephemeral (only visible to user) since channel creation may take time
    await interaction.deferReply({ ephemeral: true })

    const guild = interaction.guild
    const settings = await database.getGuildSettings(guild.id)

    // Check if user already has an open ticket to prevent spam
    const existingTickets = await database.getUserOpenTickets(guild.id, interaction.user.id)
    if (existingTickets.length > 0) {
      await interaction.editReply({ content: "You already have an open ticket." })
      return
    }

    try {
      // Generate unique ticket ID using random number
      // Format: ticket-XXXX where XXXX is random 0-9999
      const ticketNumber = Math.floor(Math.random() * 10000)
      const ticketId = `ticket-${ticketNumber}`

      // Create new private Discord channel for this ticket
      const channel = await guild.channels.create({
        // Channel name includes username and number for easy identification
        name: `ticket-${interaction.user.username}-${ticketNumber}`,
        type: ChannelType.GuildText,
        // Place in configured ticket category if set
        parent: settings?.ticket_category_id || undefined,
        // Set permissions: everyone denied except the ticket creator
        permissionOverwrites: [
          {
            // First, deny everyone access
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            // Then, allow only the ticket creator to see and message
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      })

      // Add support role permissions if configured by admin
      // Allows support staff to see and respond to all tickets
      if (settings?.support_role_id) {
        await channel.permissionOverwrites.create(settings.support_role_id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        })
      }

      // Save ticket to database for tracking and history
      await database.createTicket({
        ticketId,
        guildId: guild.id,
        channelId: channel.id,
        userId: interaction.user.id,
      })

      // Create welcome embed with ticket information
      const embed = new EmbedBuilder()
        .setTitle("Support Ticket")
        .setDescription("Thank you for creating a ticket. Our support team will be with you shortly.")
        .setColor(CONFIG.colors.primary)
        .addFields(
          { name: "Created by", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Ticket ID", value: ticketId, inline: true },
        )
        .setTimestamp()

      // Create action row with close button for easy ticket closure
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger),
      )

      // Send welcome message to ticket channel
      await channel.send({ embeds: [embed], components: [row] })

      // Confirm ticket creation to user
      await interaction.editReply({ content: `Ticket created: <#${channel.id}>` })

      // Log ticket creation in configured log channel if set
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
      // Log any errors during ticket creation
      console.error("Error creating ticket:", error)
      await interaction.editReply({ content: "An error occurred while creating the ticket." })
    }
  },

  /**
   * CLOSE EXISTING TICKET
   * ─────────────────────────────────────────────────────────────────────────
   * Closes a ticket, saves transcript, and deletes the channel
   */
  async closeTicket(interaction) {
    // Defer reply while processing ticket closure
    await interaction.deferReply()

    const channel = interaction.channel
    // Verify this is actually a ticket channel
    const ticket = await database.getTicketByChannel(channel.id)

    if (!ticket) {
      await interaction.editReply({ content: "This is not a valid ticket channel." })
      return
    }

    // Generate transcript by fetching recent messages and formatting them
    // Limit to last 100 messages to avoid excessive data
    const messages = await channel.messages.fetch({ limit: 100 })
    const transcript = messages
      .reverse() // Sort chronologically
      .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
      .join("\n")

    // Update database to mark ticket as closed
    await database.closeTicket(ticket.ticket_id, interaction.user.id, transcript)

    // Send closure notification to users in the channel
    const embed = new EmbedBuilder()
      .setTitle("Ticket Closed")
      .setDescription("This ticket has been closed. The channel will be deleted in 5 seconds.")
      .setColor(CONFIG.colors.error)
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })

    // Log closure in configured log channel if set
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

    // Delete channel after 5 second delay to let message display
    setTimeout(async () => {
      try {
        await channel.delete()
      } catch (error) {
        console.error("Error deleting ticket channel:", error)
      }
    }, 5000)
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// MODERATION COMMANDS HANDLER
// ═══════════════════════════════════════════════════════════════════════════

const moderationCommands = {
  /**
   * COMMAND ROUTER
   * ─────────────────────────────────────────────────────────────────────────
   * Routes text commands to appropriate handler functions
   */
  async handleCommand(message, command, args) {
    // Get server settings to access log channels
    const settings = await database.getGuildSettings(message.guild.id)

    // Map of available commands to their handler functions
    // Each function handles its own permission checks and error handling
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

    // Execute the command if it exists
    if (commands[command]) {
      await commands[command]()
    }
  },

  /**
   * WARN COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Add a warning to a user's record (doesn't mute or kick, just records)
   */
  async warn(message, args, settings) {
    // Check if user has moderation permissions
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get the user mentioned in the command
    const user = message.mentions.users.first()
    if (!user) {
      await message.reply("Please mention a user to warn.")
      return
    }

    // Get the reason (everything after the user mention)
    const reason = args.slice(1).join(" ") || "No reason provided"

    // Record warning in database
    await database.addWarning(message.guild.id, user.id, message.author.id, reason)

    // Create embed notification
    const embed = new EmbedBuilder()
      .setTitle("User Warned")
      .setColor(CONFIG.colors.warning)
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
        { name: "Reason", value: reason },
      )
      .setTimestamp()

    // Send notification to command channel
    await message.reply({ embeds: [embed] })

    // Log to mod log channel if configured
    if (settings?.mod_log_channel_id) {
      const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
      if (logChannel) await logChannel.send({ embeds: [embed] })
    }
  },

  /**
   * WARNINGS COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * View all warnings for a specific user
   */
  async getWarnings(message, args) {
    // Check if user has moderation permissions
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get the user mentioned in the command
    const user = message.mentions.users.first()
    if (!user) {
      await message.reply("Please mention a user to view warnings.")
      return
    }

    // Fetch all warnings from database
    const warnings = await database.getUserWarnings(message.guild.id, user.id)

    // If no warnings, let moderator know
    if (warnings.length === 0) {
      await message.reply(`<@${user.id}> has no warnings.`)
      return
    }

    // Create embed showing all warnings
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

  /**
   * CLEARWARNINGS COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Remove all warnings from a user (fresh start)
   */
  async clearWarnings(message, args) {
    // Check if user has moderation permissions
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get the user mentioned
    const user = message.mentions.users.first()
    if (!user) {
      await message.reply("Please mention a user to clear warnings.")
      return
    }

    // Delete all warnings from database
    await database.clearWarnings(message.guild.id, user.id)
    await message.reply(`Cleared all warnings for <@${user.id}>.`)
  },

  /**
   * MUTE COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Mute a user (prevent them from sending messages) for a duration or permanently
   * Format: !mute @user [duration] [reason]
   * Duration examples: 10m (10 minutes), 2h (2 hours), 1d (1 day)
   */
  async mute(message, args, settings) {
    // Check if user has moderation permissions
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get the member mentioned
    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to mute.")
      return
    }

    // Parse duration string (e.g., "10m", "2h", "1d")
    const durationStr = args[1]
    const reason = args.slice(2).join(" ") || "No reason provided"

    let duration = 0
    let expiresAt = undefined

    // Convert duration string to milliseconds
    if (durationStr) {
      const match = durationStr.match(/^(\d+)([mhd])$/)
      if (match) {
        const value = Number.parseInt(match[1])
        const unit = match[2]

        if (unit === "m")
          duration = value * 60 * 1000 // minutes
        else if (unit === "h")
          duration = value * 60 * 60 * 1000 // hours
        else if (unit === "d") duration = value * 24 * 60 * 60 * 1000 // days

        expiresAt = new Date(Date.now() + duration)
      }
    }

    try {
      // Apply Discord timeout (Discord's built-in mute feature)
      // If no duration, default to 28 days (Discord's maximum)
      await member.timeout(duration || 28 * 24 * 60 * 60 * 1000, reason)

      // Record in database for tracking
      await database.addMute(message.guild.id, member.id, message.author.id, reason, expiresAt)

      // Create notification embed
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

      // Log to mod log channel if configured
      if (settings?.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) await logChannel.send({ embeds: [embed] })
      }
    } catch (error) {
      console.error("Error muting user:", error)
      await message.reply("Failed to mute user.")
    }
  },

  /**
   * UNMUTE COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Remove mute from a user (allow them to speak again)
   */
  async unmute(message, args, settings) {
    // Check if user has moderation permissions
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get the member mentioned
    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to unmute.")
      return
    }

    try {
      // Remove Discord timeout by setting to null
      await member.timeout(null)

      // Mark as inactive in database
      await database.removeMute(message.guild.id, member.id)

      await message.reply(`Unmuted <@${member.id}>.`)

      // Log to mod log channel if configured
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
      console.error("Error unmuting user:", error)
      await message.reply("Failed to unmute user.")
    }
  },

  /**
   * KICK COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Remove a user from the server (can rejoin if they want)
   */
  async kick(message, args, settings) {
    // Check if user has kick permissions
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get the member mentioned
    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to kick.")
      return
    }

    const reason = args.slice(1).join(" ") || "No reason provided"

    try {
      // Kick the member with reason
      await member.kick(reason)

      // Create notification embed
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

      // Log to mod log channel if configured
      if (settings?.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) await logChannel.send({ embeds: [embed] })
      }
    } catch (error) {
      console.error("Error kicking user:", error)
      await message.reply("Failed to kick user.")
    }
  },

  /**
   * BAN COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Permanently ban a user from the server
   */
  async ban(message, args, settings) {
    // Check if user has ban permissions
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get the member mentioned
    const member = message.mentions.members.first()
    if (!member) {
      await message.reply("Please mention a user to ban.")
      return
    }

    const reason = args.slice(1).join(" ") || "No reason provided"

    try {
      // Ban the member with reason
      await member.ban({ reason })

      // Record in database for ban history
      await database.addBan(message.guild.id, member.id, message.author.id, reason)

      // Create notification embed
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

      // Log to mod log channel if configured
      if (settings?.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) await logChannel.send({ embeds: [embed] })
      }
    } catch (error) {
      console.error("Error banning user:", error)
      await message.reply("Failed to ban user.")
    }
  },

  /**
   * UNBAN COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Remove a ban from a user (identified by ID or tag)
   */
  async unban(message, args) {
    // Check if user has ban permissions
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get user ID or username from args
    const userIdentifier = args[0]
    if (!userIdentifier) {
      await message.reply("Please provide a user ID or username to unban.")
      return
    }

    try {
      // Unban the user
      await message.guild.bans.remove(userIdentifier)
      await message.reply(`Unbanned user: ${userIdentifier}`)
    } catch (error) {
      console.error("Error unbanning user:", error)
      await message.reply("Failed to unban user. Make sure the ID or username is correct.")
    }
  },

  /**
   * PURGE COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Delete multiple messages from a channel at once
   * Usage: !purge [number]
   */
  async purge(message, args) {
    // Check if user has manage messages permission
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Get number of messages to delete
    const amount = Number.parseInt(args[0])
    if (!amount || amount < 1 || amount > 100) {
      await message.reply("Please specify a number between 1 and 100.")
      return
    }

    try {
      // Delete messages (Discord API bulk delete)
      await message.channel.bulkDelete(amount + 1) // +1 to include the command message

      // Send confirmation (auto-delete after 5 seconds)
      const confirmation = await message.reply(`Deleted ${amount} messages.`)
      setTimeout(() => confirmation.delete().catch(() => {}), 5000)
    } catch (error) {
      console.error("Error purging messages:", error)
      await message.reply("Failed to purge messages.")
    }
  },

  /**
   * SETPREFIX COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Change the command prefix for this server
   * Usage: !setprefix [new prefix]
   */
  async setPrefix(message, args) {
    // Check if user has admin permissions
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const newPrefix = args[0]
    if (!newPrefix || newPrefix.length > 5) {
      await message.reply("Please provide a valid prefix (max 5 characters).")
      return
    }

    // Update prefix in database
    await database.updateGuildSettings(message.guild.id, { prefix: newPrefix })
    await message.reply(`Prefix changed to: \`${newPrefix}\``)
  },

  /**
   * SETUP COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Configure bot channels and roles through an interactive setup
   */
  async setup(message) {
    // Check if user has admin permissions
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    // Send setup instructions
    const embed = new EmbedBuilder()
      .setTitle("Astryx Support Bot - Setup")
      .setColor(CONFIG.colors.primary)
      .setDescription("Follow these steps to configure the bot:")
      .addFields(
        {
          name: "1. Create Ticket Category",
          value: "Create a category in your server for support tickets.",
        },
        {
          name: "2. Create Log Channels",
          value: "Create channels for ticket logs and moderation logs.\n- `#ticket-logs`\n- `#mod-logs`",
        },
        {
          name: "3. Create Support Role",
          value: "Create a role for support staff (e.g., @Support)",
        },
        {
          name: "4. Run Configuration",
          value:
            "Run these commands to set the bot up:\n" +
            "```\n" +
            "!setup-ticket [category-id]\n" +
            "!setup-logs [ticket-log-id] [mod-log-id]\n" +
            "!setup-role [support-role-id]\n" +
            "```",
        },
      )
      .setTimestamp()

    await message.reply({ embeds: [embed] })
  },

  /**
   * HELP COMMAND
   * ─────────────────────────────────────────────────────────────────────────
   * Display all available commands and their usage
   */
  async help(message) {
    // Create comprehensive help embed
    const embed = new EmbedBuilder()
      .setTitle("Astryx Support Bot - Commands")
      .setColor(CONFIG.colors.primary)
      .addFields(
        {
          name: "📋 Ticket Commands",
          value: "`!ticket` - Create a new support ticket",
        },
        {
          name: "⚠️ Warning Commands",
          value:
            "`!warn @user [reason]` - Warn a user\n" +
            "`!warnings @user` - View user warnings\n" +
            "`!clearwarnings @user` - Clear all warnings",
        },
        {
          name: "🔇 Moderation Commands",
          value:
            "`!mute @user [duration] [reason]` - Mute a user\n" +
            "`!unmute @user` - Unmute a user\n" +
            "`!kick @user [reason]` - Kick a user\n" +
            "`!ban @user [reason]` - Ban a user\n" +
            "`!unban [user-id]` - Unban a user",
        },
        {
          name: "🛠️ Admin Commands",
          value:
            "`!purge [amount]` - Delete messages\n" +
            "`!setprefix [prefix]` - Change command prefix\n" +
            "`!setup` - Get setup instructions\n" +
            "`!help` - Show this help message",
        },
      )
      .setFooter({ text: "Astryx Support Bot" })
      .setTimestamp()

    await message.reply({ embeds: [embed] })
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-MODERATION HANDLER
// ═══════════════════════════════════════════════════════════════════════════

const autoModeration = {
  /**
   * AUTO-MOD MESSAGE FILTER
   * ─────────────────────────────────────────────────────────────────────────
   * Automatically detects and prevents spam, excessive caps, and suspicious links
   */
  async filterMessage(message, settings) {
    // Skip if auto-mod is disabled for this server
    if (!settings?.auto_mod_enabled) return

    // Skip bot messages
    if (message.author.bot) return

    // Skip admin and moderators
    if (
      message.member.permissions.has(PermissionFlagsBits.Administrator) ||
      message.member.permissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return
    }

    const content = message.content

    // Check for spam (repeated characters)
    // Get spam limit from settings, default to 5 repeated chars
    const spamLimit = settings?.auto_mod_spam_limit || 5
    if (this.detectSpam(content, spamLimit)) {
      await message.delete()
      await message.author.send("Your message was deleted for spam.")
      await database.logAutoMod(message.guild.id, message.author.id, "SPAM", "Repeated characters detected")
      return
    }

    // Check for excessive caps
    // Get caps threshold from settings (percentage), default to 70%
    const capsPercent = settings?.auto_mod_caps_percent || 70
    if (this.detectExcessiveCaps(content, capsPercent)) {
      await message.delete()
      await message.author.send("Your message was deleted for excessive caps.")
      await database.logAutoMod(message.guild.id, message.author.id, "EXCESSIVE_CAPS", "Too many capital letters")
      return
    }

    // Check for suspicious links
    if (settings?.auto_mod_links_enabled && this.detectSuspiciousLinks(content)) {
      await message.delete()
      await message.author.send("Your message was deleted for containing suspicious links.")
      await database.logAutoMod(message.guild.id, message.author.id, "LINK_DETECTED", "Suspicious link detected")
      return
    }
  },

  /**
   * SPAM DETECTION
   * ─────────────────────────────────────────────────────────────────────────
   * Detects repeated characters that indicate spam
   */
  detectSpam(content, limit) {
    // Check for repeated characters: aaaaa, !!!!!!, etc.
    const spamPattern = /(.)\1{n,}/gi.replace("n", limit)
    return spamPattern.test(content)
  },

  /**
   * EXCESSIVE CAPS DETECTION
   * ─────────────────────────────────────────────────────────────────────────
   * Detects messages with too many capital letters
   */
  detectExcessiveCaps(content, threshold) {
    // Only check if message has enough letters to analyze
    if (content.length < 5) return false

    // Count capital letters vs total letters
    const letters = content.replace(/[^a-zA-Z]/g, "")
    if (letters.length === 0) return false

    const capsCount = (content.match(/[A-Z]/g) || []).length
    const capsPercentage = (capsCount / letters.length) * 100

    return capsPercentage > threshold
  },

  /**
   * SUSPICIOUS LINK DETECTION
   * ─────────────────────────────────────────────────────────────────────────
   * Detects URLs that may be malicious or spam
   */
  detectSuspiciousLinks(content) {
    // Check for common URL patterns
    // Blocks shortened URLs, phishing-like domains, etc.
    const linkPattern =
      /(https?:\/\/)?(?:bit\.ly|tinyurl|discord\.gg|twitch\.tv|youtube\.com)|(http|ftp)s?:\/\/[^\s]+/gi
    return linkPattern.test(content)
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT CLIENT INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

// Create Discord client with all necessary intents for full functionality
// Intents define which events the bot will receive
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // Access to guild (server) events
    GatewayIntentBits.GuildMessages, // Access to message events
    GatewayIntentBits.DirectMessages, // Access to DM events
    GatewayIntentBits.MessageContent, // Read message content (required for text commands)
    GatewayIntentBits.GuildMembers, // Access to member events
    GatewayIntentBits.GuildModeration, // Access to moderation events (bans, etc)
  ],
})

// ═══════════════════════════════════════════════════════════════════════════
// BOT EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * READY EVENT
 * ─────────────────────────────────────────────────────────────────────────
 * Fires when bot successfully connects to Discord
 */
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Bot logged in as ${readyClient.user.tag}`)
  console.log(`🎯 Bot is ready! Listening on ${readyClient.guilds.cache.size} servers`)

  // Set bot status
  readyClient.user.setActivity("!help for commands", { type: "LISTENING" })
})

/**
 * MESSAGE CREATE EVENT
 * ─────────────────────────────────────────────────────────────────────────
 * Fires when a message is sent in a channel the bot can see
 * Handles text commands and auto-moderation
 */
client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages (including self)
  if (message.author.bot) return

  // Get server settings
  const settings = await database.getGuildSettings(message.guild.id)

  // If no settings, create default ones
  if (!settings) {
    await database.createGuildSettings(message.guild.id)
  }

  // Get the prefix for this server (or default)
  const prefix = settings?.prefix || CONFIG.defaultPrefix

  // Check if message starts with command prefix
  if (!message.content.startsWith(prefix)) {
    // Run auto-moderation on non-command messages
    await autoModeration.filterMessage(message, settings)
    return
  }

  // Parse command and arguments
  const args = message.content.slice(prefix.length).trim().split(/ +/)
  const command = args.shift().toLowerCase()

  // Handle text-based commands
  await moderationCommands.handleCommand(message, command, args)
})

/**
 * INTERACTION CREATE EVENT
 * ─────────────────────────────────────────────────────────────────────────
 * Fires when user uses a slash command, button, or select menu
 */
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle button clicks
  if (interaction.isButton()) {
    // Check which button was clicked
    if (interaction.customId === "close_ticket") {
      // Call ticket close handler
      await ticketSystem.closeTicket(interaction)
    }
    return
  }

  // Handle slash commands
  if (!interaction.isCommand()) return

  const { commandName } = interaction

  // Handle ticket creation command
  if (commandName === "ticket") {
    await ticketSystem.createTicket(interaction)
  }
})

/**
 * GUILD CREATE EVENT
 * ─────────────────────────────────────────────────────────────────────────
 * Fires when bot joins a new server
 */
client.on(Events.GuildCreate, async (guild) => {
  console.log(`📍 Joined new guild: ${guild.name} (${guild.id})`)

  // Create default settings for new guild
  await database.createGuildSettings(guild.id)
})

/**
 * ERROR EVENT
 * ─────────────────────────────────────────────────────────────────────────
 * Catches and logs critical errors
 */
client.on("error", (error) => {
  console.error("❌ Client error:", error)
})

// ═══════════════════════════════════════════════════════════════════════════
// BOT LOGIN & START
// ═══════════════════════════════════════════════════════════════════════════

try {
  // Attempt to log in with Discord token
  await client.login(CONFIG.token)
  console.log("🚀 Astryx Support Bot is starting...")
} catch (error) {
  // Handle authentication errors
  console.error("❌ Failed to login:", error.message)
  console.error("Make sure DISCORD_BOT_TOKEN is set correctly in your environment variables")
  process.exit(1)
}
