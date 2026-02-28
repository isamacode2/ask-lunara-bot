# Ask-Lunara Discord Bot — Setup Guide

## What it does
- Listens in #ask-lunara channel
- Answers questions about Lunara using GPT-4o-mini
- Gives detailed answers for privacy/verification questions
- Escalates legal/safety questions directly to you (founder)
- Tags you if confidence is low

---

## Step 1 — Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it "Ask-Lunara"
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents** enable:
   - ✅ Message Content Intent
5. Copy the **Bot Token** — save it as DISCORD_BOT_TOKEN
6. Go to **OAuth2 → URL Generator**
7. Check: `bot` scope + permissions: `Send Messages`, `Read Messages/View Channels`, `Read Message History`
8. Open the generated URL and invite bot to your Lunara Discord server

---

## Step 2 — Create #ask-lunara channel

In your Discord server create a channel called exactly:
`ask-lunara`

---

## Step 3 — Get your Discord User ID

1. In Discord go to Settings → Advanced → Enable **Developer Mode**
2. Right click your username → **Copy User ID**
3. Save as FOUNDER_DISCORD_ID

---

## Step 4 — Get OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Create new key
3. Save as OPENAI_API_KEY

---

## Step 5 — Deploy to Railway

```bash
# In your terminal
mkdir lunara-bot
cd lunara-bot
# Copy bot.js and package.json into this folder
npm install

# Create .env file
echo "DISCORD_BOT_TOKEN=your_token" > .env
echo "OPENAI_API_KEY=your_key" >> .env
echo "FOUNDER_DISCORD_ID=your_id" >> .env

# Deploy to Railway
railway init
railway up
```

Add the 3 environment variables in Railway dashboard under Variables.

---

## Step 6 — Test it

In #ask-lunara type:
- "What is Lunara?" → should get a concise answer
- "How does verification work?" → should get a detailed answer
- "I want to make a complaint" → should tag you as founder

---

## Cost
GPT-4o-mini is extremely cheap — roughly $0.001 per question.
100 questions = ~$0.10. Negligible cost.
