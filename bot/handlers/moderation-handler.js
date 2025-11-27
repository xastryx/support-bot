/**
 * Moderation Commands Handler
 * Processes all moderation-related commands (warn, mute, kick, ban, etc.)
 */
import { EmbedBuilder, PermissionFlagsBits } from "discord.js"
import { db } from "../database"
import { config } from "../config"

export const moderationHandler = {
  async handleCommand(message, command, args) {
    const settings = await db.getGuildSettings(message.guild.id)

    switch (command) {
      case "warn":
        await this.warn(message, args, settings)
        break
      case "warnings":
        await this.getWarnings(message, args)
        break
      case "clearwarnings":
        await this.clearWarnings(message, args)
        break
      case "mute":
        await this.mute(message, args, settings)
        break
      case "unmute":
        await this.unmute(message, args, settings)
        break
      case "kick":
        await this.kick(message, args, settings)
        break
      case "ban":
        await this.ban(message, args, settings)
        break
      case "unban":
        await this.unban(message, args)
        break
      case "purge":
        await this.purge(message, args)
        break
      case "setprefix":
        await this.setPrefix(message, args)
        break
      case "setup":
        await this.setup(message, args)
        break
      case "help":
        await this.help(message)
        break
      // Additional commands can be added here
    }
  },

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

    await db.addWarning(message.guild.id, user.id, message.author.id, reason)

    const embed = new EmbedBuilder()
      .setTitle("User Warned")
      .setColor(config.colors.warning)
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
        { name: "Reason", value: reason },
      )
      .setTimestamp()

    await message.reply({ embeds: [embed] })

    // Log to mod log channel
    if (settings.mod_log_channel_id) {
      const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
      if (logChannel) {
        await logChannel.send({ embeds: [embed] })
      }
    }
  },

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

    const warnings = await db.getUserWarnings(message.guild.id, user.id)

    if (warnings.length === 0) {
      await message.reply(`<@${user.id}> has no warnings.`)
      return
    }

    const embed = new EmbedBuilder()
      .setTitle(`Warnings for ${user.tag}`)
      .setColor(config.colors.warning)
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

    await db.clearWarnings(message.guild.id, user.id)

    await message.reply(`Cleared all warnings for <@${user.id}>.`)
  },

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
      await db.addMute(message.guild.id, member.id, message.author.id, reason, expiresAt)

      const embed = new EmbedBuilder()
        .setTitle("User Muted")
        .setColor(config.colors.warning)
        .addFields(
          { name: "User", value: `<@${member.id}>`, inline: true },
          { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
          { name: "Duration", value: durationStr || "Permanent", inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()

      await message.reply({ embeds: [embed] })

      if (settings.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) {
          await logChannel.send({ embeds: [embed] })
        }
      }
    } catch (error) {
      await message.reply("Failed to mute user.")
    }
  },

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
      await db.removeMute(message.guild.id, member.id)

      await message.reply(`Unmuted <@${member.id}>.`)

      if (settings.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle("User Unmuted")
            .setColor(config.colors.success)
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
        .setColor(config.colors.error)
        .addFields(
          { name: "User", value: `<@${member.id}>`, inline: true },
          { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()

      await message.reply({ embeds: [embed] })

      if (settings.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) {
          await logChannel.send({ embeds: [embed] })
        }
      }
    } catch (error) {
      await message.reply("Failed to kick user.")
    }
  },

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
      await db.addBan(message.guild.id, member.id, message.author.id, reason)

      const embed = new EmbedBuilder()
        .setTitle("User Banned")
        .setColor(config.colors.error)
        .addFields(
          { name: "User", value: `<@${member.id}>`, inline: true },
          { name: "Moderator", value: `<@${message.author.id}>`, inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()

      await message.reply({ embeds: [embed] })

      if (settings.mod_log_channel_id) {
        const logChannel = message.guild.channels.cache.get(settings.mod_log_channel_id)
        if (logChannel) {
          await logChannel.send({ embeds: [embed] })
        }
      }
    } catch (error) {
      await message.reply("Failed to ban user.")
    }
  },

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

    await db.updateGuildSettings(message.guild.id, { prefix: newPrefix })
    await message.reply(`Prefix updated to: ${newPrefix}`)
  },

  async setup(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("You do not have permission to use this command.")
      return
    }

    const embed = new EmbedBuilder()
      .setTitle("Bot Setup Commands")
      .setColor(config.colors.primary)
      .setDescription("Use these commands to configure the bot:")
      .addFields(
        { name: "Prefix", value: "`!setprefix <prefix>` - Change the command prefix" },
        {
          name: "Manual Setup",
          value: "Configure channels and roles through Discord's server settings and use their IDs with the database.",
        },
      )

    await message.reply({ embeds: [embed] })
  },

  async help(message) {
    const embed = new EmbedBuilder()
      .setTitle("Astryx Support - Help")
      .setColor(config.colors.primary)
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
