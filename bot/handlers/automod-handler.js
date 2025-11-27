/**
 * Auto-Moderation Handler
 * Automatically detects and handles rule violations (spam, caps, links)
 */
import { EmbedBuilder } from "discord.js"
import { db } from "../database"
import { config } from "../config"

export const autoModHandler = {
  // In-memory cache for spam detection (user ID -> message timestamps)
  messageCache: new Map(),

  /**
   * Main check function - runs all auto-mod checks on a message
   * @param message Discord message to check
   * @param settings Guild auto-mod settings
   */
  async checkMessage(message, settings) {
    // Check for spam (multiple messages in short time)
    if (await this.checkSpam(message, settings)) {
      return
    }

    // Check for excessive caps
    if (this.checkCaps(message, settings)) {
      await this.handleViolation(message, "Excessive caps usage", settings)
      return
    }

    // Check for unauthorized links
    if (settings.auto_mod_links_enabled && this.checkLinks(message)) {
      await this.handleViolation(message, "Unauthorized link posting", settings)
      return
    }

    // Additional checks can be added here
  },

  /**
   * Detect spam by tracking message frequency
   * @param message Discord message to check
   * @param settings Guild auto-mod settings
   * @returns true if spam detected, false otherwise
   */
  async checkSpam(message, settings) {
    const userId = message.author.id
    const now = Date.now()
    const timeWindow = 5000 // 5 second window for spam detection

    // Get or create user's message history
    let userData = this.messageCache.get(userId)
    if (!userData) {
      userData = { count: 0, timestamps: [] }
      this.messageCache.set(userId, userData)
    }

    // Remove timestamps outside the time window
    userData.timestamps = userData.timestamps.filter((ts) => now - ts < timeWindow)
    userData.timestamps.push(now)
    userData.count = userData.timestamps.length

    // Check if user exceeded spam limit
    if (userData.count >= settings.auto_mod_spam_limit) {
      await this.handleViolation(message, "Spam detected", settings)
      // Reset counter after action taken
      userData.timestamps = []
      userData.count = 0
      return true
    }

    return false
  },

  /**
   * Check if message contains excessive capital letters
   * @param message Discord message to check
   * @param settings Guild auto-mod settings
   * @returns true if excessive caps detected
   */
  checkCaps(message, settings) {
    const text = message.content
    // Ignore short messages
    if (text.length < 5) return false

    // Calculate percentage of capital letters
    const capsCount = (text.match(/[A-Z]/g) || []).length
    const capsPercent = (capsCount / text.length) * 100

    return capsPercent >= settings.auto_mod_caps_percent
  },

  /**
   * Check if message contains URLs
   * @param message Discord message to check
   * @returns true if links detected
   */
  checkLinks(message) {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return urlRegex.test(message.content)
  },

  /**
   * Handle auto-mod violation (delete message, warn user, log action)
   * @param message Violating Discord message
   * @param reason Reason for the violation
   * @param settings Guild auto-mod settings
   */
  async handleViolation(message, reason, settings) {
    try {
      // Delete the offending message
      await message.delete()

      // Log to database
      await db.logAutoMod(message.guild.id, message.author.id, "delete", reason)

      // Send temporary warning message to channel
      const warningEmbed = new EmbedBuilder()
        .setTitle("Auto-Moderation")
        .setDescription(`<@${message.author.id}>, your message was deleted: ${reason}`)
        .setColor(config.colors.warning)
        .setTimestamp()

      const warning = await message.channel.send({ embeds: [warningEmbed] })
      // Auto-delete warning after 5 seconds to reduce clutter
      setTimeout(() => warning.delete(), 5000)

      // Log detailed information to mod log channel
      if (settings.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle("Auto-Mod Action")
            .setColor(config.colors.warning)
            .addFields(
              { name: "User", value: `<@${message.author.id}>`, inline: true },
              { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
              { name: "Reason", value: reason, inline: true },
              { name: "Message", value: message.content.substring(0, 1000) }, // Truncate long messages
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
