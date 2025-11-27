-- Guild Settings Table
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  prefix TEXT DEFAULT '!',
  ticket_category_id TEXT,
  ticket_log_channel_id TEXT,
  mod_log_channel_id TEXT,
  welcome_channel_id TEXT,
  welcome_message TEXT,
  moderator_role_id TEXT,
  support_role_id TEXT,
  auto_mod_enabled BOOLEAN DEFAULT false,
  auto_mod_spam_limit INTEGER DEFAULT 5,
  auto_mod_caps_percent INTEGER DEFAULT 70,
  auto_mod_links_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  ticket_id TEXT UNIQUE NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_by TEXT,
  transcript TEXT
);

-- Warnings Table
CREATE TABLE IF NOT EXISTS warnings (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mutes Table
CREATE TABLE IF NOT EXISTS mutes (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  active BOOLEAN DEFAULT true
);

-- Bans Table
CREATE TABLE IF NOT EXISTS bans (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Auto Mod Logs Table
CREATE TABLE IF NOT EXISTS automod_logs (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mutes_guild_user ON mutes(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_bans_guild_user ON bans(guild_id, user_id);
