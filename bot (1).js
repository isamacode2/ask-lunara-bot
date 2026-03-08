require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, Events, SlashCommandBuilder, REST, Routes } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs');

// ══════════════════════════════════════════════════════════
//  ASK-LUNARA BOT — Phase 2: Founding Member Automation
// ══════════════════════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,       // For member join events
    GatewayIntentBits.DirectMessages,     // For DM onboarding
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Config ────────────────────────────────────────────────
const FOUNDER_DISCORD_ID = process.env.FOUNDER_DISCORD_ID;
const FOUNDING_CAP = 100;

// Channel names (update these to match your server)
const CHANNELS = {
  START_HERE:     'start-here',
  INTRODUCTIONS:  'introductions',
  MOD_ALERTS:     'mod-alerts',
  ASK_LUNARA:     'ask-lunara',
  ANNOUNCEMENTS:  'founders-announcements',
  GENERAL:        'general',
  WEEKLY:         'weekly-discussion',
  MARKETING_LAB:  'marketing-lab',
};

// Role names (bot will find or create these)
const ROLES = {
  NEW_ARRIVAL:       'New Arrival',
  FOUNDING_CANDIDATE:'Founding Candidate',
  FOUNDING_MEMBER:   'Founding Member',
};

// Track onboarding state in memory (resets on restart — upgrade to DB later)
const onboardingState = new Map();

// Safety keywords that trigger escalation
const SAFETY_KEYWORDS = ['privacy concern', 'safety issue', 'harassment', 'abuse', 'stalking', 'threat', 'unsafe', 'emergency'];

// ── OpenAI System Prompt (unchanged from your original) ──
const SYSTEM_PROMPT = `
You are Ask-Lunara, the official assistant for Lunara — a privacy-first, consent-gated platform built for open relationships, polyamory, and the broader ENM community.

Core facts:
- ID verification required
- Consent-gated visibility
- No public profiles
- Zero data sold
- Founding members receive 3 months Premium free
- Community-first platform — built with 100 founding members
- Waitlist at lunara.dating
- Founding members get: early access, 3 months premium free, locked preferred rate, direct feature influence, founding badge, private Founding Lab access

If unsure, say: "That's still being finalised — check lunara.dating for updates."
Keep responses concise, confident, and inclusive.
`;

const DETAIL_KEYWORDS = ['verification', 'privacy', 'public profile', 'data storage', 'moderation', 'gdpr', 'who can see'];

// ══════════════════════════════════════════════════════════
//  HELPER: Find or create a role
// ══════════════════════════════════════════════════════════
async function getOrCreateRole(guild, roleName, color = null) {
  let role = guild.roles.cache.find(r => r.name === roleName);
  if (!role) {
    try {
      role = await guild.roles.create({
        name: roleName,
        color: color,
        reason: 'Lunara founding member system',
      });
      console.log(`✅ Created role: ${roleName}`);
    } catch (err) {
      console.error(`Failed to create role ${roleName}:`, err.message);
    }
  }
  return role;
}

// ══════════════════════════════════════════════════════════
//  HELPER: Find channel by name
// ══════════════════════════════════════════════════════════
function findChannel(guild, name) {
  return guild.channels.cache.find(c => c.name === name);
}

// ══════════════════════════════════════════════════════════
//  HELPER: Count founding members
// ══════════════════════════════════════════════════════════
function countFoundingMembers(guild) {
  const role = guild.roles.cache.find(r => r.name === ROLES.FOUNDING_MEMBER);
  return role ? role.members.size : 0;
}

// ══════════════════════════════════════════════════════════
//  READY EVENT
// ══════════════════════════════════════════════════════════
client.once('ready', async () => {
  console.log(`✅ Ask-Lunara bot is online as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guild(s)`);

  // Ensure roles exist in all guilds
  for (const guild of client.guilds.cache.values()) {
    await getOrCreateRole(guild, ROLES.NEW_ARRIVAL, '#5865F2');
    await getOrCreateRole(guild, ROLES.FOUNDING_CANDIDATE, '#E8553E');
    await getOrCreateRole(guild, ROLES.FOUNDING_MEMBER, '#6B3FA0');
    console.log(`🏷️  Roles ready in: ${guild.name}`);
  }
});

// ══════════════════════════════════════════════════════════
//  1. AUTO-WELCOME DM (when member joins)
// ══════════════════════════════════════════════════════════
client.on(Events.GuildMemberAdd, async (member) => {
  console.log(`👋 New member joined: ${member.user.tag}`);

  // Assign "New Arrival" role
  const newRole = await getOrCreateRole(member.guild, ROLES.NEW_ARRIVAL, '#5865F2');
  if (newRole) {
    try {
      await member.roles.add(newRole);
    } catch (err) {
      console.error('Failed to assign New Arrival role:', err.message);
    }
  }

  // Send welcome DM with onboarding questions
  try {
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x6B3FA0)
      .setTitle('🌙 Welcome to Lunara.')
      .setDescription(
        'This is a privacy-first ENM space built intentionally.\n\n' +
        'Founding Membership is limited to **100 seats**.\n\n' +
        'To activate your founding status, please answer these 3 questions:\n\n' +
        '**1.** What does privacy mean to you in ENM?\n' +
        '**2.** What frustrates you about existing platforms?\n' +
        '**3.** Are you solo, partnered, or poly-structured?\n\n' +
        'Reply here with your answers (all in one message is fine), then introduce yourself in **#introductions**.\n\n' +
        '_Founding seats are limited._'
      )
      .setFooter({ text: 'Lunara · lunara.dating' });

    await member.send({ embeds: [welcomeEmbed] });
    console.log(`📩 Welcome DM sent to ${member.user.tag}`);

    // Track that we're waiting for their onboarding answers
    onboardingState.set(member.id, { stage: 'awaiting_answers', guildId: member.guild.id });

  } catch (err) {
    console.error(`Could not DM ${member.user.tag}:`, err.message);
    // If DMs are closed, post in start-here instead
    const startHere = findChannel(member.guild, CHANNELS.START_HERE);
    if (startHere) {
      await startHere.send(
        `Welcome <@${member.id}>! 🌙 Check your DMs for onboarding — or if DMs are off, please answer these 3 questions here:\n\n` +
        `1. What does privacy mean to you in ENM?\n` +
        `2. What frustrates you about existing platforms?\n` +
        `3. Are you solo, partnered, or poly-structured?`
      );
    }
  }

  // Notify mod channel
  const modChannel = findChannel(member.guild, CHANNELS.MOD_ALERTS);
  if (modChannel) {
    const currentCount = countFoundingMembers(member.guild);
    await modChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xE8553E)
          .setTitle('👋 New Member Joined')
          .setDescription(
            `**${member.user.tag}** just joined.\n` +
            `Current founding members: **${currentCount}/${FOUNDING_CAP}**\n` +
            `Awaiting onboarding completion.`
          )
          .setTimestamp()
      ]
    });
  }
});

// ══════════════════════════════════════════════════════════
//  2. ONBOARDING DM HANDLER
// ══════════════════════════════════════════════════════════
client.on('messageCreate', async (message) => {
  // Only handle DMs from non-bots
  if (message.author.bot) return;
  if (message.guild) return; // Skip guild messages — handled below

  const state = onboardingState.get(message.author.id);
  if (!state || state.stage !== 'awaiting_answers') return;

  // They replied in DM with their answers
  const answers = message.content.trim();
  if (answers.length < 20) {
    await message.reply('Thanks — could you share a bit more? Even a few sentences for each question helps us understand you better. 🌙');
    return;
  }

  // Mark as complete
  onboardingState.set(message.author.id, { stage: 'complete', answers });

  // Thank them
  await message.reply(
    '🌙 **Thank you.** Your answers have been received.\n\n' +
    'Next step: Post a short intro about yourself in **#introductions**.\n\n' +
    'Once you do, a moderator will review and activate your **Founding Candidate** status.\n\n' +
    '_You\'re one step away from your founding seat._'
  );

  // Notify mod channel
  try {
    const guild = client.guilds.cache.get(state.guildId);
    if (guild) {
      const modChannel = findChannel(guild, CHANNELS.MOD_ALERTS);
      if (modChannel) {
        await modChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x8AAB8C)
              .setTitle('✅ Onboarding Complete')
              .setDescription(
                `**${message.author.tag}** completed onboarding.\n\n` +
                `**Answers:**\n${answers.substring(0, 1000)}${answers.length > 1000 ? '...' : ''}\n\n` +
                `→ Waiting for intro post in #introductions\n` +
                `→ Then assign **Founding Candidate** role`
              )
              .setTimestamp()
          ]
        });
      }

      // Assign Founding Candidate role
      const member = await guild.members.fetch(message.author.id).catch(() => null);
      if (member) {
        const candidateRole = await getOrCreateRole(guild, ROLES.FOUNDING_CANDIDATE, '#E8553E');
        const newArrivalRole = guild.roles.cache.find(r => r.name === ROLES.NEW_ARRIVAL);
        if (candidateRole) await member.roles.add(candidateRole).catch(() => {});
        if (newArrivalRole) await member.roles.remove(newArrivalRole).catch(() => {});
        console.log(`🏷️  ${message.author.tag} → Founding Candidate`);
      }
    }
  } catch (err) {
    console.error('Error processing onboarding completion:', err.message);
  }
});

// ══════════════════════════════════════════════════════════
//  3. GUILD MESSAGE HANDLER (Ask-Lunara Q&A + Commands)
// ══════════════════════════════════════════════════════════
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const content = message.content.trim();
  const lower = content.toLowerCase();

  // ── Safety Escalation ──────────────────────────────────
  if (SAFETY_KEYWORDS.some(kw => lower.includes(kw))) {
    const modChannel = findChannel(message.guild, CHANNELS.MOD_ALERTS);
    if (modChannel) {
      await modChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🚨 Safety Concern Detected')
            .setDescription(
              `**From:** ${message.author.tag} in <#${message.channel.id}>\n` +
              `**Message:** ${content.substring(0, 500)}\n\n` +
              `<@${FOUNDER_DISCORD_ID}> — please review.`
            )
            .setTimestamp()
        ]
      });
    }

    // DM the user
    try {
      await message.author.send(
        '🛡️ **Your concern has been flagged to our safety team.** We take every report seriously and will follow up as soon as possible.\n\n' +
        'If you\'re in immediate danger, please contact local emergency services.\n\n' +
        '_— Lunara Safety Team_'
      );
    } catch (err) {
      await message.reply('🛡️ Your concern has been flagged to our safety team. We\'ll follow up shortly.');
    }
  }

  // ── /feedback command ──────────────────────────────────
  if (lower.startsWith('/feedback') || lower.startsWith('!feedback')) {
    const feedbackContent = content.replace(/^\/(feedback|!feedback)\s*/i, '').trim();

    if (!feedbackContent) {
      const feedbackEmbed = new EmbedBuilder()
        .setColor(0x6B3FA0)
        .setTitle('💬 Share Your Feedback')
        .setDescription(
          'Use this format:\n\n' +
          '`/feedback [category] [your feedback]`\n\n' +
          '**Categories:** UX, Safety, Features, Pricing, General\n\n' +
          'Example:\n`/feedback Features I want video call support before meeting`'
        );
      await message.reply({ embeds: [feedbackEmbed] });
      return;
    }

    // Parse category
    const categories = ['ux', 'safety', 'features', 'pricing', 'general'];
    const words = feedbackContent.split(' ');
    let category = 'General';
    if (categories.includes(words[0]?.toLowerCase())) {
      category = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
      words.shift();
    }
    const feedbackText = words.join(' ');

    // Send to feedback channel or mod-alerts
    const targetChannel = findChannel(message.guild, 'product-feedback') || findChannel(message.guild, CHANNELS.MOD_ALERTS);
    if (targetChannel) {
      await targetChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x6B3FA0)
            .setTitle('💬 New Feedback')
            .addFields(
              { name: 'From', value: message.author.tag, inline: true },
              { name: 'Category', value: category, inline: true },
              { name: 'Feedback', value: feedbackText.substring(0, 1000) || 'No details provided' }
            )
            .setTimestamp()
        ]
      });
    }

    await message.reply('✅ Thanks — your feedback has been logged. The team reviews everything. 🌙');
    return;
  }

  // ── /founding-count command ────────────────────────────
  if (lower === '/founding-count' || lower === '!founding-count') {
    const count = countFoundingMembers(message.guild);
    const remaining = Math.max(FOUNDING_CAP - count, 0);

    const embed = new EmbedBuilder()
      .setColor(remaining > 0 ? 0x6B3FA0 : 0xE8553E)
      .setTitle('🌙 Founding Member Status')
      .setDescription(
        remaining > 0
          ? `**${count}/${FOUNDING_CAP}** founding seats filled.\n**${remaining}** spots remaining.`
          : `🔒 **All ${FOUNDING_CAP} founding seats are filled.**\nFounding membership is now closed.`
      );

    await message.reply({ embeds: [embed] });
    return;
  }

  // ── /promote command (mod only) ────────────────────────
  if (lower.startsWith('/promote') || lower.startsWith('!promote')) {
    // Check if sender has admin/mod permissions
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await message.reply('You don\'t have permission to promote members.');
      return;
    }

    const mentioned = message.mentions.members.first();
    if (!mentioned) {
      await message.reply('Usage: `/promote @user` — Promotes a Founding Candidate to Founding Member.');
      return;
    }

    const currentCount = countFoundingMembers(message.guild);
    if (currentCount >= FOUNDING_CAP) {
      await message.reply(`🔒 Founding cap reached (${FOUNDING_CAP}/${FOUNDING_CAP}). Cannot promote more members.`);
      return;
    }

    const founderRole = await getOrCreateRole(message.guild, ROLES.FOUNDING_MEMBER, '#6B3FA0');
    const candidateRole = message.guild.roles.cache.find(r => r.name === ROLES.FOUNDING_CANDIDATE);

    if (founderRole) await mentioned.roles.add(founderRole).catch(() => {});
    if (candidateRole) await mentioned.roles.remove(candidateRole).catch(() => {});

    const newCount = currentCount + 1;
    const remaining = FOUNDING_CAP - newCount;

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6B3FA0)
          .setTitle('🏅 Founding Member Activated')
          .setDescription(
            `<@${mentioned.id}> is now a **Founding Member**.\n\n` +
            `Seats filled: **${newCount}/${FOUNDING_CAP}**\n` +
            `Remaining: **${remaining}**`
          )
      ]
    });

    // DM the new founding member
    try {
      await mentioned.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x6B3FA0)
            .setTitle('🏅 You\'re a Founding Member.')
            .setDescription(
              'Your seat is confirmed. You are one of the first 100.\n\n' +
              '**What this means:**\n' +
              '• Early access before public launch\n' +
              '• 3 months Premium — free\n' +
              '• Locked preferred rate forever\n' +
              '• Direct influence on features\n' +
              '• Founding badge inside Lunara\n' +
              '• Private Founding Lab access\n\n' +
              '_Thank you for building this with us._ 🌙'
            )
        ]
      });
    } catch (err) {
      console.error(`Could not DM ${mentioned.user.tag}`);
    }

    // Check if cap is reached
    if (newCount >= FOUNDING_CAP) {
      const announceChannel = findChannel(message.guild, CHANNELS.ANNOUNCEMENTS) || findChannel(message.guild, CHANNELS.GENERAL);
      if (announceChannel) {
        await announceChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xE8553E)
              .setTitle('🔒 100 Founding Members — Complete.')
              .setDescription(
                'All 100 founding seats are now filled.\n' +
                'Founding membership is officially closed.\n\n' +
                'To every founding member — you built this. Thank you. 🌙'
              )
          ]
        });
      }
    }
    return;
  }

  // ── @mention Ask-Lunara (original Q&A) ─────────────────
  if (message.mentions.has(client.user)) {
    const question = content.replace(/<@!?\d+>/g, '').trim();
    if (!question) return;

    const lowerQ = question.toLowerCase();
    const needsDetail = DETAIL_KEYWORDS.some(kw => lowerQ.includes(kw));
    const maxTokens = needsDetail ? 300 : 150;

    console.log('Processing question:', question);

    try {
      await message.channel.sendTyping();

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
      });

      const answer = completion.choices[0]?.message?.content?.trim();
      if (!answer) {
        await message.reply("I didn't quite catch that. Could you rephrase? 🌙");
        return;
      }

      const vagueIndicators = ["i don't know", "not sure", "unclear", "cannot answer"];
      const isVague = vagueIndicators.some(v => answer.toLowerCase().includes(v));

      if (isVague && FOUNDER_DISCORD_ID) {
        await message.reply(`${answer}\n\n_Tagging <@${FOUNDER_DISCORD_ID}> for clarification._`);
      } else {
        await message.reply(answer);
      }
    } catch (error) {
      console.error('OpenAI error:', error);
      await message.reply("I'm having a moment — please try again shortly. 🌙");
    }
    return;
  }

  // ── Intro post detection (in #introductions) ──────────
  if (message.channel.name === CHANNELS.INTRODUCTIONS) {
    if (content.length > 50) {
      // Acknowledge the intro
      await message.react('🌙');

      // Notify mods
      const modChannel = findChannel(message.guild, CHANNELS.MOD_ALERTS);
      if (modChannel) {
        await modChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x8AAB8C)
              .setTitle('📝 New Introduction Posted')
              .setDescription(
                `**${message.author.tag}** posted in #introductions.\n\n` +
                `Preview: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n\n` +
                `→ If onboarding is complete, use \`/promote @${message.author.username}\` to activate founding status.`
              )
              .setTimestamp()
          ]
        });
      }
    }
  }
});

// ══════════════════════════════════════════════════════════
//  4. WEEKLY PROMPTS (Scheduled Posts)
// ══════════════════════════════════════════════════════════
function scheduleWeeklyPrompts() {
  const prompts = {
    1: { // Monday — Privacy Insight
      title: '🔒 Monday Privacy Insight',
      messages: [
        'This week\'s topic: **What does "discreet" mean to you in practice?** When you set your visibility to discreet on a dating platform, what do you actually expect to happen?',
        'Privacy isn\'t one-size-fits-all. **What\'s one privacy feature you wish existed** on dating platforms that you\'ve never seen?',
        'Discussion: **Should ENM platforms verify relationship structures** (e.g. confirming a partner knows about the account)? What are the ethics?',
        'Quick thought: **Most dating apps sell your data.** What made you stop trusting a platform with your information?',
      ]
    },
    3: { // Wednesday — Founders Build Thread
      title: '🗳️ Wednesday Build Thread',
      messages: [
        'Founders — **vote on the next feature priority:**\n\n🗓️ Event & meetup spaces\n📞 In-app video calls\n👥 Community forums\n🤝 Partner introductions\n\nReact with the matching emoji to vote.',
        'What\'s **one thing you\'d change** about how existing ENM platforms handle matching? We\'re building the algorithm now — your input matters.',
        'Design question: **Should Lunara show relationship structure** (solo poly, kitchen table, etc.) on profiles by default, or only when someone asks?',
        'Feature check: We\'re building consent-gated media sharing. **What rules should govern when photos can be exchanged?**',
      ]
    },
    5: { // Friday — Community Pulse
      title: '⚡ Friday Pulse',
      messages: [
        '**Quick poll:** What\'s more important to you — privacy features or matching quality? React 🔒 for privacy, 🎯 for matching.',
        'End of week reflection: **What\'s one positive experience** you\'ve had in the ENM community this week?',
        '**One word** to describe what Lunara should feel like. Go.',
        'The weekend is here. **What does your ideal ENM date look like?** (Keep it PG — we\'re building trust here 😄)',
      ]
    },
    0: { // Sunday — Slow Conversation
      title: '🌙 Sunday Slow Conversation',
      messages: [
        '**Slow thread:** What made you explore ethical non-monogamy? No pressure to share more than you\'re comfortable with.',
        'Sunday reflection: **What\'s one boundary you\'ve learned to set** that changed your relationships for the better?',
        '**What does "belonging" look like** in a dating community? We named Lunara after the moon for a reason — quiet, constant, present.',
        'Gentle prompt: **Who taught you the most about consent?** A partner, a book, a conversation? Share if you like.',
      ]
    }
  };

  setInterval(() => {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Post at 10:00 AM UK time on scheduled days
    if (hour === 10 && minute === 0) {
      const prompt = prompts[day];
      if (prompt) {
        const randomMsg = prompt.messages[Math.floor(Math.random() * prompt.messages.length)];

        for (const guild of client.guilds.cache.values()) {
          const channel = findChannel(guild, CHANNELS.WEEKLY) || findChannel(guild, CHANNELS.GENERAL);
          if (channel) {
            channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x6B3FA0)
                  .setTitle(prompt.title)
                  .setDescription(randomMsg)
                  .setFooter({ text: 'Lunara Founding Lab' })
              ]
            }).catch(err => console.error('Weekly prompt error:', err.message));
          }
        }
      }
    }
  }, 60000); // Check every minute
}

// ══════════════════════════════════════════════════════════
//  5. FOUNDER ACQUISITION ENGINE (/acquire)
// ══════════════════════════════════════════════════════════

const ACQUIRE_SYSTEM_PROMPT = `
You are a marketing strategist for Lunara.

Lunara is:
- A privacy-first, consent-architected ENM platform
- Governance-led, not chaos-led
- Built with 100 founding members
- Structured, calm, serious
- Not sexual, not edgy, not hype-driven

Tone rules:
- No emojis
- No slang
- No sexual framing
- No anti-monogamy attacks
- No desperation tone
- Calm authority only

Objectives:
- Attract privacy-conscious ENM adults
- Emphasize structure, consent, accountability
- Create curiosity, not pressure
- Invite discussion before pitching

When generating posts:
- Provide 3 variations
- Include one engagement question
- Keep X posts under 280 characters
- Threads must be structured and logical
- Avoid repetitive phrases
- Always end softly with: "We're building this with 100 founders."
`;

// Marketing usage log
function logAcquireUsage(platform, angle, tone) {
  const entry = { platform, angle, tone, timestamp: new Date().toISOString() };
  try {
    fs.appendFileSync('marketing_log.json', JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Log error:', err.message);
  }
}

// Register slash commands
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('acquire')
      .setDescription('Generate founder acquisition content')
      .addStringOption(opt =>
        opt.setName('platform')
          .setDescription('Target platform')
          .setRequired(true)
          .addChoices(
            { name: 'X / Twitter', value: 'x' },
            { name: 'LinkedIn', value: 'linkedin' },
            { name: 'Reddit', value: 'reddit' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'DM Outreach', value: 'dm' },
          ))
      .addStringOption(opt =>
        opt.setName('angle')
          .setDescription('Content angle')
          .setRequired(true)
          .addChoices(
            { name: 'Privacy', value: 'privacy' },
            { name: 'Consent', value: 'consent' },
            { name: 'Governance', value: 'governance' },
            { name: 'Scarcity', value: 'scarcity' },
            { name: 'Anti-Chaos', value: 'anti-chaos' },
            { name: 'Accountability', value: 'accountability' },
          ))
      .addStringOption(opt =>
        opt.setName('tone')
          .setDescription('Tone intensity')
          .setRequired(true)
          .addChoices(
            { name: 'Soft', value: 'soft' },
            { name: 'Direct', value: 'direct' },
            { name: 'Strong', value: 'strong' },
          )),
    new SlashCommandBuilder()
      .setName('founding-count')
      .setDescription('Check how many founding seats remain'),
    new SlashCommandBuilder()
      .setName('promote')
      .setDescription('Promote a Founding Candidate to Founding Member')
      .addUserOption(opt =>
        opt.setName('user')
          .setDescription('User to promote')
          .setRequired(true)),
  ].map(cmd => cmd.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.BOT_CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Slash command registration error:', err.message);
  }
}

// Handle slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ── /acquire ───────────────────────────────────────────
  if (interaction.commandName === 'acquire') {
    // Only allow in marketing-lab or by server owner
    const isMarketingChannel = interaction.channel.name === CHANNELS.MARKETING_LAB;
    const isOwner = interaction.user.id === FOUNDER_DISCORD_ID;

    if (!isMarketingChannel && !isOwner) {
      await interaction.reply({ content: 'This command is only available in #marketing-lab.', ephemeral: true });
      return;
    }

    const platform = interaction.options.getString('platform');
    const angle = interaction.options.getString('angle');
    const tone = interaction.options.getString('tone');

    await interaction.deferReply();

    const userPrompt = `
Generate marketing content for Lunara.

Platform: ${platform}
Angle focus: ${angle}
Tone intensity: ${tone}

Provide clearly separated sections:

1. SHORT POST (under 280 characters for X, appropriate length for other platforms)

2. STRUCTURED THREAD (5-7 points, each on its own line, numbered)

3. ALTERNATIVE SOFTER VERSION (same message, gentler delivery)

4. ENGAGEMENT QUESTION (one question that invites discussion)

5. DM OUTREACH TEMPLATE (personal, non-pushy message to send to potential founders)

Keep tone disciplined and structured. No emojis. No hype. Calm authority.
End with: "We're building this with 100 founders."
`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 1500,
        messages: [
          { role: 'system', content: ACQUIRE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });

      const output = completion.choices[0]?.message?.content?.trim();
      if (!output) {
        await interaction.editReply('Generation failed. Try again.');
        return;
      }

      // Log usage
      logAcquireUsage(platform, angle, tone);

      // Split into chunks if > 2000 chars (Discord limit)
      const header = `**Founder Acquisition Content**\nPlatform: \`${platform}\` | Angle: \`${angle}\` | Tone: \`${tone}\`\n${'─'.repeat(40)}`;

      if ((header + '\n\n' + output).length <= 2000) {
        await interaction.editReply(header + '\n\n' + output);
      } else {
        await interaction.editReply(header);
        // Split output into 1900-char chunks
        const chunks = [];
        let remaining = output;
        while (remaining.length > 0) {
          if (remaining.length <= 1900) {
            chunks.push(remaining);
            break;
          }
          let splitAt = remaining.lastIndexOf('\n', 1900);
          if (splitAt === -1) splitAt = 1900;
          chunks.push(remaining.substring(0, splitAt));
          remaining = remaining.substring(splitAt).trim();
        }
        for (const chunk of chunks) {
          await interaction.channel.send(chunk);
        }
      }

    } catch (error) {
      console.error('Acquire error:', error);
      await interaction.editReply('Generation failed. Check OpenAI key and try again.');
    }
    return;
  }

  // ── /founding-count (slash version) ────────────────────
  if (interaction.commandName === 'founding-count') {
    const count = countFoundingMembers(interaction.guild);
    const remaining = Math.max(FOUNDING_CAP - count, 0);

    const embed = new EmbedBuilder()
      .setColor(remaining > 0 ? 0x6B3FA0 : 0xE8553E)
      .setTitle('Founding Member Status')
      .setDescription(
        remaining > 0
          ? `**${count}/${FOUNDING_CAP}** founding seats filled.\n**${remaining}** spots remaining.`
          : `**All ${FOUNDING_CAP} founding seats are filled.**\nFounding membership is now closed.`
      );

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ── /promote (slash version) ───────────────────────────
  if (interaction.commandName === 'promote') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({ content: 'You don\'t have permission to promote members.', ephemeral: true });
      return;
    }

    const mentioned = interaction.options.getMember('user');
    if (!mentioned) {
      await interaction.reply({ content: 'User not found in this server.', ephemeral: true });
      return;
    }

    const currentCount = countFoundingMembers(interaction.guild);
    if (currentCount >= FOUNDING_CAP) {
      await interaction.reply(`Founding cap reached (${FOUNDING_CAP}/${FOUNDING_CAP}). Cannot promote more members.`);
      return;
    }

    const founderRole = await getOrCreateRole(interaction.guild, ROLES.FOUNDING_MEMBER, '#6B3FA0');
    const candidateRole = interaction.guild.roles.cache.find(r => r.name === ROLES.FOUNDING_CANDIDATE);

    if (founderRole) await mentioned.roles.add(founderRole).catch(() => {});
    if (candidateRole) await mentioned.roles.remove(candidateRole).catch(() => {});

    const newCount = currentCount + 1;
    const remaining = FOUNDING_CAP - newCount;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6B3FA0)
          .setTitle('Founding Member Activated')
          .setDescription(
            `<@${mentioned.id}> is now a **Founding Member**.\n\n` +
            `Seats filled: **${newCount}/${FOUNDING_CAP}**\n` +
            `Remaining: **${remaining}**`
          )
      ]
    });

    // DM the new founding member
    try {
      await mentioned.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x6B3FA0)
            .setTitle('You\'re a Founding Member.')
            .setDescription(
              'Your seat is confirmed. You are one of the first 100.\n\n' +
              '**What this means:**\n' +
              '• Early access before public launch\n' +
              '• 3 months Premium at launch\n' +
              '• Locked preferred rate forever\n' +
              '• Direct influence on features\n' +
              '• Founding badge inside Lunara\n' +
              '• Private Founding Lab access\n\n' +
              '_Thank you for building this with us._'
            )
        ]
      });
    } catch (err) {
      console.error(`Could not DM ${mentioned.user.tag}`);
    }

    // Check if cap reached
    if (newCount >= FOUNDING_CAP) {
      const announceChannel = findChannel(interaction.guild, CHANNELS.ANNOUNCEMENTS) || findChannel(interaction.guild, CHANNELS.GENERAL);
      if (announceChannel) {
        await announceChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xE8553E)
              .setTitle('100 Founding Members — Complete.')
              .setDescription(
                'All 100 founding seats are now filled.\n' +
                'Founding membership is officially closed.\n\n' +
                'To every founding member — you built this. Thank you.'
              )
          ]
        });
      }
    }
    return;
  }
});

// ══════════════════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════════════════
client.once('ready', () => {
  registerSlashCommands();
  scheduleWeeklyPrompts();
  console.log('📅 Weekly prompts scheduled');
  console.log('🚀 Acquisition engine ready');
});

client.login(process.env.DISCORD_BOT_TOKEN);
