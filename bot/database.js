/**
 * Database Interface Layer
 * Handles all database operations using Neon serverless Postgres
 */
import { neon } from "@neondatabase/serverless"

// Initialize Neon SQL client with connection string
const sql = neon(process.env.POSTGRES_URL)

export const db = {
  // ==================== Guild Settings ====================

  /**
   * Retrieve guild-specific configuration
   * @param guildId Discord guild ID
   * @returns Guild settings object or null if not found
   */
  async getGuildSettings(guildId) {
    const result = await sql`
      SELECT * FROM guild_settings WHERE guild_id = ${guildId}
    `
    return result[0] || null
  },

  /**
   * Create default settings for a new guild
   * @param guildId Discord guild ID
   * @returns Created settings object
   */
  async createGuildSettings(guildId) {
    const result = await sql`
      INSERT INTO guild_settings (guild_id)
      VALUES (${guildId})
      ON CONFLICT (guild_id) DO NOTHING
      RETURNING *
    `
    return result[0]
  },

  /**
   * Update guild settings with partial updates
   * @param guildId Discord guild ID
   * @param settings Object containing fields to update
   * @returns Updated settings object
   */
  async updateGuildSettings(guildId, settings) {
    const keys = Object.keys(settings)
    const values = Object.values(settings)

    // Dynamically build SET clause for SQL query
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ")

    const result = await sql(
      `
      UPDATE guild_settings 
      SET ${setClause}, updated_at = NOW()
      WHERE guild_id = $1
      RETURNING *
    `,
      [guildId, ...values],
    )

    return result[0]
  },

  // ==================== Tickets ====================

  /**
   * Create a new support ticket
   * @param ticketData Object containing ticket information
   * @returns Created ticket object
   */
  async createTicket(ticketData) {
    const result = await sql`
      INSERT INTO tickets (ticket_id, guild_id, channel_id, user_id, category)
      VALUES (${ticketData.ticketId}, ${ticketData.guildId}, ${ticketData.channelId}, ${ticketData.userId}, ${ticketData.category || null})
      RETURNING *
    `
    return result[0]
  },

  /**
   * Get ticket by unique ticket ID
   * @param ticketId Ticket identifier
   * @returns Ticket object or null
   */
  async getTicket(ticketId) {
    const result = await sql`
      SELECT * FROM tickets WHERE ticket_id = ${ticketId}
    `
    return result[0] || null
  },

  /**
   * Get active ticket by Discord channel ID
   * @param channelId Discord channel ID
   * @returns Open ticket object or null
   */
  async getTicketByChannel(channelId) {
    const result = await sql`
      SELECT * FROM tickets WHERE channel_id = ${channelId} AND status = 'open'
    `
    return result[0] || null
  },

  /**
   * Get all open tickets for a specific user in a guild
   * @param guildId Discord guild ID
   * @param userId Discord user ID
   * @returns Array of open tickets
   */
  async getUserOpenTickets(guildId, userId) {
    const result = await sql`
      SELECT * FROM tickets 
      WHERE guild_id = ${guildId} AND user_id = ${userId} AND status = 'open'
    `
    return result
  },

  /**
   * Close a ticket and save transcript
   * @param ticketId Ticket identifier
   * @param closedBy Discord user ID of closer
   * @param transcript Optional chat transcript
   * @returns Updated ticket object
   */
  async closeTicket(ticketId, closedBy, transcript) {
    const result = await sql`
      UPDATE tickets 
      SET status = 'closed', closed_at = NOW(), closed_by = ${closedBy}, transcript = ${transcript || null}
      WHERE ticket_id = ${ticketId}
      RETURNING *
    `
    return result[0]
  },

  // ==================== Warnings ====================

  /**
   * Add a warning to a user's record
   * @param guildId Discord guild ID
   * @param userId Discord user ID being warned
   * @param moderatorId Discord user ID of moderator
   * @param reason Reason for the warning
   * @returns Created warning object
   */
  async addWarning(guildId, userId, moderatorId, reason) {
    const result = await sql`
      INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason})
      RETURNING *
    `
    return result[0]
  },

  /**
   * Get all warnings for a user in a guild
   * @param guildId Discord guild ID
   * @param userId Discord user ID
   * @returns Array of warnings, newest first
   */
  async getUserWarnings(guildId, userId) {
    const result = await sql`
      SELECT * FROM warnings 
      WHERE guild_id = ${guildId} AND user_id = ${userId}
      ORDER BY created_at DESC
    `
    return result
  },

  /**
   * Remove all warnings for a user
   * @param guildId Discord guild ID
   * @param userId Discord user ID
   */
  async clearWarnings(guildId, userId) {
    await sql`
      DELETE FROM warnings 
      WHERE guild_id = ${guildId} AND user_id = ${userId}
    `
  },

  // ==================== Mutes ====================

  /**
   * Add a mute record (temporary or permanent)
   * @param guildId Discord guild ID
   * @param userId Discord user ID being muted
   * @param moderatorId Discord user ID of moderator
   * @param reason Reason for the mute
   * @param expiresAt Optional expiration timestamp
   * @returns Created mute object
   */
  async addMute(guildId, userId, moderatorId, reason, expiresAt) {
    const result = await sql`
      INSERT INTO mutes (guild_id, user_id, moderator_id, reason, expires_at)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason}, ${expiresAt || null})
      RETURNING *
    `
    return result[0]
  },

  /**
   * Deactivate a user's mute
   * @param guildId Discord guild ID
   * @param userId Discord user ID
   */
  async removeMute(guildId, userId) {
    await sql`
      UPDATE mutes 
      SET active = false 
      WHERE guild_id = ${guildId} AND user_id = ${userId} AND active = true
    `
  },

  /**
   * Get all active mutes for a guild (used for expiration checking)
   * @param guildId Discord guild ID
   * @returns Array of active mutes
   */
  async getActiveMutes(guildId) {
    const result = await sql`
      SELECT * FROM mutes 
      WHERE guild_id = ${guildId} AND active = true
    `
    return result
  },

  // ==================== Bans ====================

  /**
   * Record a ban in the database
   * @param guildId Discord guild ID
   * @param userId Discord user ID being banned
   * @param moderatorId Discord user ID of moderator
   * @param reason Reason for the ban
   * @returns Created ban object
   */
  async addBan(guildId, userId, moderatorId, reason) {
    const result = await sql`
      INSERT INTO bans (guild_id, user_id, moderator_id, reason)
      VALUES (${guildId}, ${userId}, ${moderatorId}, ${reason})
      RETURNING *
    `
    return result[0]
  },

  // ==================== Auto Mod Logs ====================

  /**
   * Log an auto-moderation action
   * @param guildId Discord guild ID
   * @param userId Discord user ID of violator
   * @param action Type of action taken (delete, warn, etc.)
   * @param reason Reason for the action
   */
  async logAutoMod(guildId, userId, action, reason) {
    await sql`
      INSERT INTO automod_logs (guild_id, user_id, action, reason)
      VALUES (${guildId}, ${userId}, ${action}, ${reason})
    `
  },

  // ==================== User Profiles ====================

  /**
   * Retrieve user profile information
   * @param userId Discord user ID
   * @returns User profile object or null if not found
   */
  async getUserProfile(userId) {
    const result = await sql`
      SELECT * FROM user_profiles WHERE user_id = ${userId}
    `
    return result[0] || null
  },

  /**
   * Create a new user profile
   * @param userId Discord user ID
   * @param profileData Object containing profile information
   * @returns Created profile object
   */
  async createUserProfile(userId, profileData) {
    const result = await sql`
      INSERT INTO user_profiles (user_id, profile_data)
      VALUES (${userId}, ${profileData})
      ON CONFLICT (user_id) DO NOTHING
      RETURNING *
    `
    return result[0]
  },

  /**
   * Update user profile with partial updates
   * @param userId Discord user ID
   * @param profileData Object containing fields to update
   * @returns Updated profile object
   */
  async updateUserProfile(userId, profileData) {
    const keys = Object.keys(profileData)
    const values = Object.values(profileData)

    // Dynamically build SET clause for SQL query
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ")

    const result = await sql(
      `
      UPDATE user_profiles 
      SET ${setClause}, updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `,
      [userId, ...values],
    )

    return result[0]
  },
}
