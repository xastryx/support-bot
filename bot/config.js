/**
 * Bot Configuration
 * Centralizes all configuration values and constants
 */
export const config = {
  // Bot authentication token from Discord Developer Portal
  token: process.env.DISCORD_BOT_TOKEN || "",

  // Application ID from Discord Developer Portal
  clientId: process.env.DISCORD_CLIENT_ID || "",

  // Default command prefix (can be changed per-guild)
  defaultPrefix: "!",

  // Embed color scheme for consistent branding
  colors: {
    primary: 0x5865f2, // Discord Blurple
    success: 0x57f287, // Green
    warning: 0xfee75c, // Yellow
    error: 0xed4245, // Red
  },

  // Additional configuration for logging
  logging: {
    level: process.env.LOGGING_LEVEL || "info",
    file: process.env.LOGGING_FILE || "bot.log",
  },
}
