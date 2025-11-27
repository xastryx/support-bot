/**
 * Ticket System Handler
 * Manages support ticket creation, closure, and transcripts
 */
import {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js"
import { db } from "../database"
import { config } from "../config"

export const ticketHandler = {
  /**
   * Route button interactions to appropriate handlers
   * @param interaction Button interaction from Discord
   */
  async handleButton(interaction) {
    if (interaction.customId === "create_ticket") {
      await this.createTicket(interaction)
    } else if (interaction.customId === "close_ticket") {
      await this.closeTicket(interaction)
    }
  },

  /**
   * Create a new support ticket channel
   * @param interaction Button interaction that triggered ticket creation
   */
  async createTicket(interaction) {
    // Acknowledge interaction immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true })

    const guild = interaction.guild
    const member = interaction.member
    const settings = await db.getGuildSettings(guild.id)

    // Prevent users from creating multiple tickets
    const existingTickets = await db.getUserOpenTickets(guild.id, interaction.user.id)
    if (existingTickets.length > 0) {
      await interaction.editReply({
        content: "You already have an open ticket.",
      })
      return
    }

    try {
      // Generate unique ticket identifier
      const ticketNumber = Math.floor(Math.random() * 10000)
      const ticketId = `ticket-${ticketNumber}`

      // Create private ticket channel
      const channel = await guild.channels.create({
        name: `ticket-${interaction.user.username}-${ticketNumber}`,
        type: ChannelType.GuildText,
        parent: settings?.ticket_category_id || undefined, // Place in configured category
        permissionOverwrites: [
          {
            id: guild.id, // @everyone role
            deny: [PermissionFlagsBits.ViewChannel], // Hide from everyone
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

      // Grant access to support role if configured
      if (settings?.support_role_id) {
        await channel.permissionOverwrites.create(settings.support_role_id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        })
      }

      // Save ticket to database
      await db.createTicket({
        ticketId,
        guildId: guild.id,
        channelId: channel.id,
        userId: interaction.user.id,
      })

      // Send welcome message with close button
      const embed = new EmbedBuilder()
        .setTitle("Support Ticket")
        .setDescription("Thank you for creating a ticket. Our support team will be with you shortly.")
        .setColor(config.colors.primary)
        .addFields(
          { name: "Created by", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Ticket ID", value: ticketId, inline: true },
        )
        .setTimestamp()

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger),
      )

      await channel.send({ embeds: [embed], components: [row] })

      // Notify user of ticket creation
      await interaction.editReply({
        content: `Ticket created: <#${channel.id}>`,
      })

      // Log ticket creation to admin channel
      if (settings?.ticket_log_channel_id) {
        const logChannel = guild.channels.cache.get(settings.ticket_log_channel_id)
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle("Ticket Created")
            .setColor(config.colors.success)
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
      await interaction.editReply({
        content: "An error occurred while creating the ticket.",
      })
    }
  },

  /**
   * Close an existing ticket and generate transcript
   * @param interaction Button interaction from close button
   */
  async closeTicket(interaction) {
    await interaction.deferReply()

    const channel = interaction.channel
    const ticket = await db.getTicketByChannel(channel.id)

    // Verify this is actually a ticket channel
    if (!ticket) {
      await interaction.editReply({
        content: "This is not a valid ticket channel.",
      })
      return
    }

    // Generate chat transcript from last 100 messages
    const messages = await channel.messages.fetch({ limit: 100 })
    const transcript = messages
      .reverse()
      .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
      .join("\n")

    // Update database with closure information
    await db.closeTicket(ticket.ticket_id, interaction.user.id, transcript)

    // Send closure notification
    const embed = new EmbedBuilder()
      .setTitle("Ticket Closed")
      .setDescription("This ticket has been closed. The channel will be deleted in 5 seconds.")
      .setColor(config.colors.error)
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })

    // Log closure to admin channel
    const settings = await db.getGuildSettings(interaction.guild.id)
    if (settings?.ticket_log_channel_id) {
      const logChannel = interaction.guild.channels.cache.get(settings.ticket_log_channel_id)
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle("Ticket Closed")
          .setColor(config.colors.error)
          .addFields(
            { name: "Ticket", value: channel.name, inline: true },
            { name: "Closed by", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Ticket ID", value: ticket.ticket_id, inline: true },
          )
          .setTimestamp()

        await logChannel.send({ embeds: [logEmbed] })
      }
    }

    // Delete channel after 5 second delay
    setTimeout(async () => {
      try {
        await channel.delete()
      } catch (error) {
        console.error("Error deleting ticket channel:", error)
      }
    }, 5000)
  },
}
