# Astryx Support Bot Setup Guide

## Prerequisites

1. Discord Bot Token
2. Discord Client ID
3. Database 

## Step 1: Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and name it "Astryx Support"
3. Go to "Bot" section and click "Add Bot"
4. Enable these Privileged Gateway Intents:
   - Server Members Intent
   - Message Content Intent
5. Copy the bot token

## Step 2: Add Environment Variables

Add these to your project environment variables:

\`\`\`
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
\`\`\`

## Step 3: Invite Bot to Server

Use this URL (replace CLIENT_ID with your actual client ID):

\`\`\`
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot
\`\`\`

## Step 4: Run Database Scripts

The SQL scripts in `/scripts` folder will create all necessary tables. 

## Step 5: Start the Bot

Run the bot locally:

\`\`\`bash
npm run bot
\`\`\`

Or deploy to a hosting service that supports Node.js applications.

## Commands

### Moderation
- `!warn @user <reason>` - Warn a user
- `!warnings @user` - View user warnings
- `!clearwarnings @user` - Clear user warnings
- `!mute @user <duration> <reason>` - Mute a user (duration: 10m, 2h, 1d)
- `!unmute @user` - Unmute a user
- `!kick @user <reason>` - Kick a user
- `!ban @user <reason>` - Ban a user
- `!unban <user_id>` - Unban a user
- `!purge <amount>` - Delete messages (1-100)

### Configuration
- `!setprefix <prefix>` - Change command prefix
- `!setup` - View setup guide
- `!help` - Show all commands

### Tickets
Create ticket buttons in a channel to allow users to open support tickets.

## Configuration

Update guild settings in the database to configure:
- Ticket category ID
- Ticket log channel ID
- Mod log channel ID
- Support role ID
- Auto-mod settings

## Auto-Moderation

When enabled, the bot automatically detects and removes:
- Spam messages
- Excessive caps
- Unauthorized links

Configure thresholds in the guild_settings table.
