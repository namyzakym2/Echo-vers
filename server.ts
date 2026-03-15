import express from "express";
import { createServer as createViteServer } from "vite";
import * as Discord from "discord.js";
import type { Interaction, ButtonBuilder, StringSelectMenuBuilder } from "discord.js";
const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonStyle, 
  EmbedBuilder, 
  ChannelType, 
  PermissionFlagsBits,
  PermissionsBitField,
  GuildMember,
  StringSelectMenuOptionBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = Discord;
const { ButtonBuilder: ButtonBuilderClass, StringSelectMenuBuilder: StringSelectMenuBuilderClass } = Discord;
const Permissions = PermissionFlagsBits;
import { db, auth } from "./src/firebase";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import dotenv from "dotenv";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import DiscordStrategyPkg from "passport-discord";
const DiscordStrategy = DiscordStrategyPkg.Strategy;
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function startServer() {
  await signInAnonymously(auth);
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Passport & Session Setup
  app.use(session({
    secret: process.env.SESSION_SECRET || 'discord-bot-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
    }
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj: any, done) => done(null, obj));

  const APP_URL = process.env.APP_URL || `https://${process.env.PROJECT_ID}.run.app`;
  const REDIRECT_URI = `${APP_URL}/api/auth/callback`;

  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    passport.use(new DiscordStrategy({
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: REDIRECT_URI,
      scope: ['identify', 'guilds']
    }, (accessToken, refreshToken, profile, done) => {
      return done(null, profile);
    }));
  }

  // Discord Bot Setup
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  let botStatus = "Offline";
  let lastMessage = "No messages yet";
  const logs: string[] = [];
  const mafiaGames: Map<string, { players: string[], hostId: string }> = new Map();

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    logs.push(`[${timestamp}] ${msg}`);
    if (logs.length > 50) logs.shift();
    console.log(`[BOT LOG] ${msg}`);
  };

  // Command Aliases & Custom Commands Cache
  const commandAliases: Map<string, string> = new Map();
  const customCommands: Map<string, string> = new Map();
  const voiceJoinTimes: Map<string, number> = new Map();

  const addXp = async (userId: string, username: string, avatar: string, xpToAdd: number) => {
    const userRef = doc(db, "users", userId);
    try {
      const userDoc = await getDoc(userRef);
      if (!userDoc.exists()) {
        await setDoc(userRef, { xp: xpToAdd, level: 1, lastMessage: new Date().toISOString(), username, avatar });
      } else {
        const data = userDoc.data();
        let newXp = data.xp + xpToAdd;
        let newLevel = data.level;
        const xpNeeded = newLevel * 100;
        if (newXp >= xpNeeded) {
          newXp -= xpNeeded;
          newLevel++;
        }
        await updateDoc(userRef, { xp: newXp, level: newLevel, lastMessage: new Date().toISOString(), username, avatar });
      }
    } catch (err) {
      addLog(`XP error: ${err}`);
    }
  };

  const loadAliases = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "commands"));
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.type === "custom") {
          customCommands.set(data.customName, data.response);
        } else {
          commandAliases.set(data.originalName, data.customName);
        }
      });
      addLog("Loaded command aliases and custom commands from database.");
    } catch (err) {
      addLog(`Error loading aliases: ${err}`);
    }
  };

  const getCommandName = (original: string) => {
    return commandAliases.get(original) || original;
  };

  const loginBot = async () => {
    if (process.env.DISCORD_TOKEN) {
      try {
        botStatus = "Connecting...";
        addLog("Attempting to login to Discord...");
        await client.login(process.env.DISCORD_TOKEN);
      } catch (err: any) {
        if (err.message.includes("disallowed intents")) {
          addLog("❌ ERROR: Disallowed Intents!");
          addLog("👉 ACTION REQUIRED: Go to Discord Developer Portal > Bot > Privileged Gateway Intents");
          addLog("👉 ENABLE 'Message Content Intent', 'Server Members', and 'Presence'.");
          addLog("👉 Then click 'Save Changes' and the bot will connect.");
        } else {
          addLog(`Login error: ${err.message}`);
        }
        botStatus = "Error";
        // Retry login after 30 seconds if it fails
        setTimeout(loginBot, 30000);
      }
    } else {
      addLog("DISCORD_TOKEN not found. Please add it to your secrets.");
      botStatus = "Missing Token";
    }
  };

  loginBot();

  // Voice XP Tracking
  setInterval(async () => {
    for (const [userId, joinTime] of voiceJoinTimes.entries()) {
      // Find the member in all guilds
      let foundMember = null;
      for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(userId);
        if (member && member.voice.channelId) {
          foundMember = member;
          break;
        }
      }
      
      if (foundMember) {
        await addXp(userId, foundMember.user.username, foundMember.user.displayAvatarURL(), 2);
        voiceJoinTimes.set(userId, Date.now()); // Reset join time
        addLog(`Added 2 XP to ${foundMember.user.username} for voice activity.`);
      } else {
        // User might have left or bot lost track
        voiceJoinTimes.delete(userId);
      }
    }
  }, 60000);

  client.on("voiceStateUpdate", async (oldState, newState) => {
    const userId = newState.id;
    if (newState.member?.user.bot) return;

    // Joined a channel
    if (!oldState.channelId && newState.channelId) {
      voiceJoinTimes.set(userId, Date.now());
    }
    // Left a channel
    else if (oldState.channelId && !newState.channelId) {
      voiceJoinTimes.delete(userId);
    }
  });

  client.on("ready", async () => {
    botStatus = "Online";
    addLog(`Logged in as ${client.user?.tag}! Bot is now active.`);
    loadAliases();

    // Register Slash Commands
    try {
      const commands = [
        new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
        new SlashCommandBuilder().setName('id').setDescription('عرض معلومات العضو')
          .addUserOption(o => o.setName('user').setDescription('العضو المراد عرض معلوماته').setRequired(false)),
        new SlashCommandBuilder().setName('alias').setDescription('إضافة اختصار لأمر')
          .addStringOption(o => o.setName('name').setDescription('الاسم الجديد للاختصار').setRequired(true))
          .addStringOption(o => o.setName('original').setDescription('الاسم الأصلي للأمر').setRequired(true)),
        new SlashCommandBuilder().setName('level').setDescription('Check your XP & level'),
        new SlashCommandBuilder().setName('mafia').setDescription('Start a Mafia game'),
        new SlashCommandBuilder().setName('roulette').setDescription('Play roulette with your XP')
          .addIntegerOption(option => option.setName('amount').setDescription('Amount to bet').setRequired(true)),
        new SlashCommandBuilder().setName('cut').setDescription('Random question/activity'),
        new SlashCommandBuilder().setName('add-cmd').setDescription('Add a custom command')
          .addStringOption(o => o.setName('name').setDescription('Command name').setRequired(true))
          .addStringOption(o => o.setName('reply').setDescription('Command reply').setRequired(true)),
        new SlashCommandBuilder().setName('edit-command').setDescription('Edit a command')
          .addStringOption(o => o.setName('old').setDescription('Old name').setRequired(true))
          .addStringOption(o => o.setName('new').setDescription('New name').setRequired(true)),
        new SlashCommandBuilder().setName('request').setDescription('Request a feature')
          .addStringOption(o => o.setName('feature').setDescription('Feature description').setRequired(true)),
        new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
          .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true)),
        new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
          .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true)),
        new SlashCommandBuilder().setName('mute').setDescription('Mute a member')
          .addUserOption(o => o.setName('user').setDescription('User to mute').setRequired(true)),
        new SlashCommandBuilder().setName('unmute').setDescription('Unmute a member')
          .addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),
        new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
          .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true)),
        new SlashCommandBuilder().setName('clear').setDescription('Clear messages')
          .addIntegerOption(o => o.setName('amount').setDescription('Amount to clear').setRequired(true)),
        new SlashCommandBuilder().setName('setup-tickets').setDescription('Setup ticket system')
          .addRoleOption(o => o.setName('role').setDescription('Role for tickets').setRequired(true)),
        new SlashCommandBuilder().setName('reset-server').setDescription('Reset server'),
        new SlashCommandBuilder().setName('register-commands').setDescription('Manually register slash commands'),
      ].map(command => command.toJSON());

      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
      const clientId = client.user!.id;
      
      addLog(`Started refreshing application (/) commands for Client ID: ${clientId}`);
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      addLog("Successfully reloaded application (/) commands.");
    } catch (err: any) {
      addLog(`Slash Command Registration Error: ${err.message}`);
      if (err.message.includes("authorized")) {
        addLog("👉 TIP: This error usually means the DISCORD_TOKEN and the application ID don't match, or the bot lacks 'applications.commands' scope.");
      }
    }
  });

  client.on("error", (error) => {
    addLog(`Discord Client Error: ${error.message}`);
    botStatus = "Error";
  });

  client.on("shardDisconnect", (event) => {
    addLog(`Bot disconnected: ${event.reason || "Unknown reason"}`);
    botStatus = "Disconnected";
    // Attempt to relogin if disconnected
    setTimeout(loginBot, 5000);
  });

  client.on("shardReconnecting", () => {
    addLog("Bot is attempting to reconnect...");
    botStatus = "Reconnecting";
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    lastMessage = `${message.author.username}: ${message.content}`;
    addLog(`Message from ${message.author.username}: ${message.content}`);

    // Leveling System
    await addXp(message.author.id, message.author.username, message.author.displayAvatarURL(), Math.floor(Math.random() * 5) + 2);

    const content = message.content.trim();

    if (content === "/ping") {
      message.reply("Pong!");
    }

    if (content === "/level") {
      try {
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          message.reply(`مستواك الحالي: ${data.level} | الخبرة: ${data.xp}/${data.level * 100}`);
        } else {
          message.reply("لم تبدأ بعد! أرسل بعض الرسائل لزيادة مستواك.");
        }
      } catch (err) {
        message.reply("حدث خطأ أثناء جلب مستواك.");
      }
    }

    // Edit Command Name Logic
    if (content.startsWith("/edit-command")) {
      const isServerOwner = message.author.id === message.guild?.ownerId;
      const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
      if (!isServerOwner && !isAdmin) return message.reply("هذا الأمر للمسؤولين فقط.");

      const args = content.split(" ");
      if (args.length < 3) return message.reply("الاستخدام: `/edit-command [الاسم_الأصلي] [الاسم_الجديد]`\nمثال: `/edit-command reset-server reset` ");
      
      const original = args[1].replace("/", "");
      const custom = args[2].startsWith("/") ? args[2] : `/${args[2]}`;

      try {
        await setDoc(doc(db, "commands", original), { 
          originalName: original, 
          customName: custom,
          type: "alias" 
        });
        commandAliases.set(original, custom);
        message.reply(`تم تغيير اسم الأمر من /${original} إلى ${custom} بنجاح ✅`);
      } catch (err) {
        addLog(`Error saving command alias: ${err}`);
        message.reply("فشل حفظ التعديل في قاعدة البيانات.");
      }
      return;
    }

    // Add Custom Command Logic
    if (content.startsWith("/add-cmd")) {
      const isServerOwner = message.author.id === message.guild?.ownerId;
      const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
      if (!isServerOwner && !isAdmin) return message.reply("هذا الأمر للمسؤولين فقط.");

      const args = content.split(" ");
      if (args.length < 3) return message.reply("الاستخدام: `/add-cmd [الاسم] [الرد]`\nمثال: `/add-cmd /hi أهلاً بك في السيرفر!`");

      const cmdName = args[1].startsWith("/") ? args[1] : `/${args[1]}`;
      const response = args.slice(2).join(" ");

      try {
        await setDoc(doc(db, "commands", cmdName), { 
          originalName: cmdName, 
          customName: cmdName, 
          response: response,
          type: "custom" 
        });
        customCommands.set(cmdName, response);
        message.reply(`تم إضافة الأمر الجديد ${cmdName} بنجاح ✅`);
      } catch (err) {
        addLog(`Error adding custom command: ${err}`);
        message.reply("فشل إضافة الأمر في قاعدة البيانات.");
      }
      return;
    }

    // Moderation Commands
    if (content.startsWith("/kick")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply("ليس لديك صلاحية طرد الأعضاء.");
      const member = message.mentions.members?.first();
      if (!member) return message.reply("الرجاء تحديد العضو المراد طرده.");
      try {
        await member.kick();
        message.reply(`تم طرد ${member.user.tag} بنجاح.`);
      } catch (err) {
        message.reply("فشل طرد العضو.");
      }
      return;
    }

    if (content.startsWith("/ban")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply("ليس لديك صلاحية حظر الأعضاء.");
      const member = message.mentions.members?.first();
      if (!member) return message.reply("الرجاء تحديد العضو المراد حظره.");
      try {
        await member.ban();
        message.reply(`تم حظر ${member.user.tag} بنجاح.`);
      } catch (err) {
        message.reply("فشل حظر العضو.");
      }
      return;
    }

    if (content.startsWith("/mute")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply("ليس لديك صلاحية إسكات الأعضاء.");
      const member = message.mentions.members?.first();
      if (!member) return message.reply("الرجاء تحديد العضو المراد إسكاته.");
      try {
        await member.timeout(60000 * 60); // Mute for 1 hour
        message.reply(`تم إسكات ${member.user.tag} لمدة ساعة.`);
      } catch (err) {
        message.reply("فشل إسكات العضو.");
      }
      return;
    }

    if (content.startsWith("/unmute")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply("ليس لديك صلاحية إلغاء الإسكات.");
      const member = message.mentions.members?.first();
      if (!member) return message.reply("الرجاء تحديد العضو المراد إلغاء إسكاته.");
      try {
        await member.timeout(null);
        message.reply(`تم إلغاء إسكات ${member.user.tag}.`);
      } catch (err) {
        message.reply("فشل إلغاء إسكات العضو.");
      }
      return;
    }

    if (content.startsWith("/warn")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply("ليس لديك صلاحية تحذير الأعضاء.");
      const member = message.mentions.members?.first();
      if (!member) return message.reply("الرجاء تحديد العضو المراد تحذيره.");
      const reason = content.split(" ").slice(2).join(" ") || "لا يوجد سبب";
      message.reply(`تم تحذير ${member.user.tag}. السبب: ${reason}`);
      return;
    }

    if (content.startsWith("/clear")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply("ليس لديك صلاحية مسح الرسائل.");
      if (message.channel.type !== ChannelType.GuildText) return message.reply("هذا الأمر يعمل فقط في الرومات النصية.");
      const amount = parseInt(content.split(" ")[1]);
      if (isNaN(amount) || amount < 1 || amount > 100) return message.reply("الرجاء تحديد عدد الرسائل (1-100).");
      try {
        await message.channel.bulkDelete(amount + 1);
        message.reply(`تم مسح ${amount} رسالة.`);
      } catch (err) {
        message.reply("فشل مسح الرسائل.");
      }
      return;
    }

    // Feature Request Logic
    if (content.startsWith("/request")) {
      const requestText = content.replace("/request", "").trim();
      if (!requestText) return message.reply("الرجاء كتابة الميزة التي تريد إضافتها: `/request [وصف الميزة]`");

      try {
        const requestId = Date.now().toString();
        await setDoc(doc(db, "requests", requestId), {
          userId: message.author.id,
          username: message.author.username,
          request: requestText,
          status: "pending",
          timestamp: new Date().toISOString()
        });
        message.reply("✅ تم استلام طلبك! سأقوم بمراجعته وتنفيذه في التحديث القادم إن شاء الله.");
        addLog(`New feature request from ${message.author.username}: ${requestText}`);
      } catch (err) {
        addLog(`Error saving request: ${err}`);
        message.reply("فشل إرسال الطلب، حاول مرة أخرى لاحقاً.");
      }
      return;
    }

    // Handle Custom Commands
    if (customCommands.has(content)) {
      return message.reply(customCommands.get(content)!);
    }

    // --- Games Section ---

    // 1. Roulette Game (/roulette [amount])
    if (content.startsWith("/roulette") || content.startsWith("/روليت")) {
      const args = content.split(" ");
      const amount = parseInt(args[1]);

      if (isNaN(amount) || amount <= 0) {
        return message.reply("الرجاء تحديد مبلغ صحيح للمراهنة: `/roulette [النقاط]`");
      }

      try {
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) return message.reply("ليس لديك نقاط كافية! ابدأ بالدردشة أولاً.");
        
        const userData = userDoc.data();
        if (userData.xp < amount) {
          return message.reply(`ليس لديك نقاط كافية! نقاطك الحالية: ${userData.xp}`);
        }

        const win = Math.random() > 0.5;
        const newXp = win ? userData.xp + amount : userData.xp - amount;

        await updateDoc(userRef, { xp: newXp });

        if (win) {
          message.reply(`🎉 مبروك! لقد فزت بـ ${amount} نقطة. رصيدك الحالي: ${newXp}`);
        } else {
          message.reply(`💀 للأسف، لقد خسرت ${amount} نقطة. رصيدك الحالي: ${newXp}`);
        }
      } catch (err) {
        addLog(`Roulette error: ${err}`);
        message.reply("حدث خطأ أثناء تنفيذ لعبة الروليت.");
      }
      return;
    }

    // 2. Cut Game (/كت)
    if (content === "/كت" || content === "/cut") {
      const questions = [
        "ما هو حلمك الأكبر في الحياة؟",
        "أكثر موقف محرج تعرضت له؟",
        "لو خيروك بين المال والحب، ماذا تختار؟",
        "أفضل صديق لك في هذا السيرفر؟",
        "ما هي هوايتك المفضلة؟",
        "أكلة مستحيل تأكلها؟",
        "أجمل بلد زرته؟",
        "شخص تفتقده حالياً؟",
        "لو كنت ملكاً ليوم واحد، ماذا ستفعل؟",
        "ما هو الشيء الذي يجعلك تبتسم دائماً؟"
      ];
      const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
      
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("🎲 لعبة كت تويت")
        .setDescription(randomQuestion)
        .setFooter({ text: `بواسطة: ${message.author.username}` });

      return message.reply({ embeds: [embed] });
    }

    // 3. Mafia Game (/mafia)
    if (content === "/mafia" || content === "/مافيا") {
      const channelId = message.channel.id;
      if (mafiaGames.has(channelId)) {
        return message.reply("هناك لعبة مافيا قيد الانتظار بالفعل في هذا الروم.");
      }

      mafiaGames.set(channelId, { players: [message.author.id], hostId: message.author.id });

      const embed = new EmbedBuilder()
        .setTitle("🕵️ لعبة المافيا - بانتظار اللاعبين")
        .setDescription(`المضيف: ${message.author.username}\nاللاعبين المنضمين: 1\n\nاضغط على الزر أدناه للمشاركة!\nتحتاج اللعبة إلى 4 لاعبين على الأقل للبدء.`)
        .setColor(0x2B2D31);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilderClass()
          .setCustomId("join_mafia")
          .setLabel("انضمام")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("👤"),
        new ButtonBuilderClass()
          .setCustomId("start_mafia")
          .setLabel("بدء اللعبة")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🎮")
      );

      return message.channel.send({ embeds: [embed], components: [row] });
    }

    const resetCmd = getCommandName("reset-server");
    if (content === resetCmd || content === "/reset-server") {
      const isServerOwner = message.author.id === message.guild?.ownerId;
      const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
      const hasOwnerRole = message.member?.roles.cache.some(role => 
        role.name.toLowerCase().includes('owner') || 
        role.name.includes('اونر') || 
        role.name.includes('الاونر')
      );

      if (!isServerOwner && !isAdmin && !hasOwnerRole) {
        return message.reply("عذراً، هذا الأمر مخصص للأونر والإدارة العليا فقط ⚠️");
      }

      const guild = message.guild;
      if (!guild) return;

      addLog(`CRITICAL: Server reset initiated by owner ${message.author.username}`);
      
      await message.reply("⚠️ جاري البدء في تصفير السيرفر... سيتم حذف جميع الرومات، الرتب، وطرد الأعضاء (باستثناء المالك، البوت، وأنت).");

      // Delete roles
      try {
        const roles = await guild.roles.fetch();
        let roleCount = 0;
        for (const [id, role] of roles) {
          // Don't delete @everyone, bot roles, or managed roles
          if (role.name !== "@everyone" && !role.managed && role.editable) {
            await role.delete("تصفير السيرفر (Server Reset)").catch(e => addLog(`Could not delete role ${role.name}: ${e.message}`));
            roleCount++;
          }
        }
        addLog(`Deleted ${roleCount} roles.`);
      } catch (err: any) {
        addLog(`Error deleting roles: ${err.message}`);
      }

      // Kick members
      try {
        const members = await guild.members.fetch();
        let kickCount = 0;
        for (const [id, member] of members) {
          // Kick everyone except: Owner, Bot itself, and the Command Author
          if (id !== guild.ownerId && id !== client.user?.id && id !== message.author.id && member.kickable) {
            await member.kick("تصفير السيرفر (Server Reset)");
            kickCount++;
          }
        }
        addLog(`Kicked ${kickCount} members.`);
      } catch (err: any) {
        addLog(`Error kicking members: ${err.message}`);
      }

      // Delete channels
      try {
        const channels = await guild.channels.fetch();
        for (const [id, channel] of channels) {
          if (channel) {
            await channel.delete().catch(e => addLog(`Could not delete channel ${id}: ${e.message}`));
          }
        }
        
        // Create a new general channel so the server isn't empty
        await guild.channels.create({
          name: "general",
          type: ChannelType.GuildText
        });
        
        addLog("Server channels reset completed.");
      } catch (err: any) {
        addLog(`Error resetting channels: ${err.message}`);
      }
      return;
    }

    if (message.content.startsWith("/setup-tickets")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply("تحتاج إلى صلاحيات Administrator لاستخدام هذا الأمر.");
      }

      const args = message.content.split(" ");
      const roleMention = message.mentions.roles.first();
      const roleId = roleMention?.id || args[1];

      if (!roleId) {
        return message.reply("الرجاء تحديد الرتبة التي ستستلم التذاكر: `/setup-tickets @Role` أو `/setup-tickets ROLE_ID`.");
      }

      const embed = new EmbedBuilder()
        .setTitle("نظام التذاكر")
        .setDescription("اضغط على الزر أدناه لفتح تذكرة والتحدث مع الدعم الفني.")
        .setColor(0x5865F2)
        .setTimestamp()
        .setFooter({ text: "نظام الدعم الفني" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilderClass()
          .setCustomId(`open_ticket:${roleId}`)
          .setLabel("الدعم الفني")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🎟️")
      );

      message.channel.send({ embeds: [embed], components: [row] });
      addLog(`Ticket setup command used by ${message.author.username} for role ${roleId}`);
    }
  });

  client.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      const { commandName, user, guildId } = interaction;

      if (commandName === 'ping') {
        await interaction.reply('Pong!');
      }

      if (commandName === 'id') {
        const targetUser = interaction.options.getUser('user') || user;
        const member = await interaction.guild?.members.fetch(targetUser.id);
        const embed = new EmbedBuilder()
          .setTitle(`معلومات العضو: ${targetUser.username}`)
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: "الاسم", value: targetUser.username, inline: true },
            { name: "المعرف (ID)", value: targetUser.id, inline: true },
            { name: "تاريخ الانضمام", value: member?.joinedAt?.toLocaleDateString() || "غير معروف", inline: true }
          )
          .setColor(0x5865F2);
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'alias') {
        const isServerOwner = user.id === interaction.guild?.ownerId;
        const isAdmin = interaction.member?.permissions instanceof PermissionsBitField && interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isServerOwner && !isAdmin) return interaction.reply({ content: "هذا الأمر للمسؤولين فقط.", ephemeral: true });

        const name = interaction.options.getString('name')!;
        const original = interaction.options.getString('original')!;
        const custom = name.startsWith("/") ? name : `/${name}`;

        try {
          await setDoc(doc(db, "commands", original), { 
            originalName: original, 
            customName: custom,
            type: "alias" 
          });
          commandAliases.set(original, custom);
          await interaction.reply(`تم إضافة الاختصار ${custom} للأمر /${original} بنجاح ✅`);
        } catch (err) {
          addLog(`Error saving command alias: ${err}`);
          await interaction.reply("فشل حفظ الاختصار في قاعدة البيانات.");
        }
      }

      if (commandName === 'level') {
        const userRef = doc(db, "users", user.id);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          await interaction.reply(`مستواك الحالي: ${data.level} | الخبرة: ${data.xp}/${data.level * 100}`);
        } else {
          await interaction.reply("لم تبدأ بعد! أرسل بعض الرسائل لزيادة مستواك.");
        }
      }

      if (commandName === 'cut') {
        const questions = [
          "ما هو حلمك الأكبر في الحياة؟",
          "أكثر موقف محرج تعرضت له؟",
          "لو خيروك بين المال والحب، ماذا تختار؟",
          "أفضل صديق لك في هذا السيرفر؟",
          "ما هي هوايتك المفضلة؟",
          "أكلة مستحيل تأكلها؟",
          "أجمل بلد زرته؟",
          "شخص تفتقده حالياً؟",
          "لو كنت ملكاً ليوم واحد، ماذا ستفعل؟",
          "ما هو الشيء الذي يجعلك تبتسم دائماً؟"
        ];
        const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("🎲 لعبة كت تويت")
          .setDescription(randomQuestion)
          .setFooter({ text: `بواسطة: ${user.username}` });
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'roulette') {
        const amount = interaction.options.getInteger('amount')!;
        const userRef = doc(db, "users", user.id);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) return interaction.reply({ content: "ليس لديك نقاط كافية! ابدأ بالدردشة أولاً.", ephemeral: true });
        
        const userData = userDoc.data();
        if (userData.xp < amount) {
          return interaction.reply({ content: `ليس لديك نقاط كافية! نقاطك الحالية: ${userData.xp}`, ephemeral: true });
        }

        const win = Math.random() > 0.5;
        const newXp = win ? userData.xp + amount : userData.xp - amount;
        await updateDoc(userRef, { xp: newXp });

        if (win) {
          await interaction.reply(`🎉 مبروك! لقد فزت بـ ${amount} نقطة. رصيدك الحالي: ${newXp}`);
        } else {
          await interaction.reply(`💀 للأسف، لقد خسرت ${amount} نقطة. رصيدك الحالي: ${newXp}`);
        }
      }

      if (commandName === 'add-cmd') {
        const isServerOwner = user.id === interaction.guild?.ownerId;
        const isAdmin = interaction.member?.permissions instanceof PermissionsBitField && interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isServerOwner && !isAdmin) return interaction.reply({ content: "هذا الأمر للمسؤولين فقط.", ephemeral: true });

        const name = interaction.options.getString('name')!;
        const reply = interaction.options.getString('reply')!;
        const cmdName = name.startsWith("/") ? name : `/${name}`;

        try {
          await setDoc(doc(db, "commands", name.replace("/", "")), { 
            originalName: name.replace("/", ""), 
            customName: cmdName,
            type: "custom",
            response: reply
          });
          customCommands.set(cmdName, reply);
          await interaction.reply(`تم إضافة الأمر ${cmdName} بنجاح ✅`);
        } catch (err) {
          addLog(`Error saving custom command: ${err}`);
          await interaction.reply("فشل حفظ الأمر في قاعدة البيانات.");
        }
      }

      if (commandName === 'edit-command') {
        const isServerOwner = user.id === interaction.guild?.ownerId;
        const isAdmin = interaction.member?.permissions instanceof PermissionsBitField && interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isServerOwner && !isAdmin) return interaction.reply({ content: "هذا الأمر للمسؤولين فقط.", ephemeral: true });

        const oldName = interaction.options.getString('old')!;
        const newName = interaction.options.getString('new')!;
        const original = oldName.replace("/", "");
        const custom = newName.startsWith("/") ? newName : `/${newName}`;

        try {
          await setDoc(doc(db, "commands", original), { 
            originalName: original, 
            customName: custom,
            type: "alias" 
          });
          commandAliases.set(original, custom);
          await interaction.reply(`تم تغيير اسم الأمر من /${original} إلى ${custom} بنجاح ✅`);
        } catch (err) {
          addLog(`Error saving command alias: ${err}`);
          await interaction.reply("فشل حفظ التعديل في قاعدة البيانات.");
        }
      }

      if (commandName === 'request') {
        const feature = interaction.options.getString('feature')!;
        try {
          const requestId = Date.now().toString();
          await setDoc(doc(db, "requests", requestId), { 
            user: user.username, 
            feature: feature,
            timestamp: new Date()
          });
          await interaction.reply("✅ تم استلام طلبك! سأقوم بمراجعته وتنفيذه في التحديث القادم إن شاء الله.");
        } catch (err) {
          addLog(`Error saving feature request: ${err}`);
          await interaction.reply("فشل حفظ الطلب.");
        }
      }

      if (commandName === 'mafia') {
        if (!interaction.channel) return;
        const channelId = interaction.channel.id;
        if (mafiaGames.has(channelId)) {
          return interaction.reply({ content: "هناك لعبة مافيا قيد الانتظار بالفعل في هذا الروم.", ephemeral: true });
        }

        mafiaGames.set(channelId, { players: [user.id], hostId: user.id });

        const embed = new EmbedBuilder()
          .setTitle("🕵️ لعبة المافيا - بانتظار اللاعبين")
          .setDescription(`المضيف: ${user.username}\nاللاعبين المنضمين: 1\n\nاضغط على الزر أدناه للمشاركة!\nتحتاج اللعبة إلى 4 لاعبين على الأقل للبدء.`)
          .setColor(0x2B2D31);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilderClass()
            .setCustomId("join_mafia")
            .setLabel("انضمام")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("👤"),
          new ButtonBuilderClass()
            .setCustomId("start_mafia")
            .setLabel("بدء اللعبة")
            .setStyle(ButtonStyle.Success)
            .setEmoji("🎮")
        );

        await interaction.reply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'kick') {
        const permissions = interaction.member?.permissions;
        if (!permissions || !(permissions instanceof PermissionsBitField) || !permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: "ليس لديك صلاحية طرد الأعضاء.", ephemeral: true });
        const member = interaction.options.getMember('user');
        if (!member || !(member instanceof GuildMember)) {
            // Try fetching if it's not a GuildMember
            const guildMember = await interaction.guild?.members.fetch(interaction.options.getUser('user')!.id);
            if (!guildMember) return interaction.reply({ content: "الرجاء تحديد العضو المراد طرده.", ephemeral: true });
            try {
              await guildMember.kick("طرد بواسطة البوت");
              await interaction.reply(`تم طرد ${guildMember.user.tag} بنجاح ✅`);
            } catch (err) {
              await interaction.reply("فشل طرد العضو.");
            }
        } else {
            try {
              await member.kick("طرد بواسطة البوت");
              await interaction.reply(`تم طرد ${member.user.tag} بنجاح ✅`);
            } catch (err) {
              await interaction.reply("فشل طرد العضو.");
            }
        }
      }

      if (commandName === 'ban') {
        const permissions = interaction.member?.permissions;
        if (!permissions || !(permissions instanceof PermissionsBitField) || !permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: "ليس لديك صلاحية حظر الأعضاء.", ephemeral: true });
        const member = interaction.options.getMember('user');
        const guildMember = (member instanceof GuildMember) ? member : await interaction.guild?.members.fetch(interaction.options.getUser('user')!.id);
        if (!guildMember) return interaction.reply({ content: "الرجاء تحديد العضو المراد حظره.", ephemeral: true });
        try {
          await guildMember.ban({ reason: "حظر بواسطة البوت" });
          await interaction.reply(`تم حظر ${guildMember.user.tag} بنجاح ✅`);
        } catch (err) {
          await interaction.reply("فشل حظر العضو.");
        }
      }

      if (commandName === 'mute') {
        const permissions = interaction.member?.permissions;
        if (!permissions || !(permissions instanceof PermissionsBitField) || !permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: "ليس لديك صلاحية إسكات الأعضاء.", ephemeral: true });
        const member = interaction.options.getMember('user');
        const guildMember = (member instanceof GuildMember) ? member : await interaction.guild?.members.fetch(interaction.options.getUser('user')!.id);
        if (!guildMember) return interaction.reply({ content: "الرجاء تحديد العضو المراد إسكاته.", ephemeral: true });
        try {
          await guildMember.timeout(60 * 60 * 1000, "إسكات بواسطة البوت");
          await interaction.reply(`تم إسكات ${guildMember.user.tag} لمدة ساعة بنجاح ✅`);
        } catch (err) {
          await interaction.reply("فشل إسكات العضو.");
        }
      }

      if (commandName === 'unmute') {
        const permissions = interaction.member?.permissions;
        if (!permissions || !(permissions instanceof PermissionsBitField) || !permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: "ليس لديك صلاحية إلغاء الإسكات.", ephemeral: true });
        const member = interaction.options.getMember('user');
        const guildMember = (member instanceof GuildMember) ? member : await interaction.guild?.members.fetch(interaction.options.getUser('user')!.id);
        if (!guildMember) return interaction.reply({ content: "الرجاء تحديد العضو المراد إلغاء إسكاته.", ephemeral: true });
        try {
          await guildMember.timeout(null, "إلغاء إسكات بواسطة البوت");
          await interaction.reply(`تم إلغاء إسكات ${guildMember.user.tag} بنجاح ✅`);
        } catch (err) {
          await interaction.reply("فشل إلغاء إسكات العضو.");
        }
      }

      if (commandName === 'warn') {
        const permissions = interaction.member?.permissions;
        if (!permissions || !(permissions instanceof PermissionsBitField) || !permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: "ليس لديك صلاحية تحذير الأعضاء.", ephemeral: true });
        const member = interaction.options.getMember('user');
        const guildMember = (member instanceof GuildMember) ? member : await interaction.guild?.members.fetch(interaction.options.getUser('user')!.id);
        if (!guildMember) return interaction.reply({ content: "الرجاء تحديد العضو المراد تحذيره.", ephemeral: true });
        await interaction.reply(`تم تحذير ${guildMember.user.tag} بنجاح ✅`);
      }

      if (commandName === 'clear') {
        const permissions = interaction.member?.permissions;
        if (!permissions || !(permissions instanceof PermissionsBitField) || !permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: "ليس لديك صلاحية مسح الرسائل.", ephemeral: true });
        if (interaction.channel?.type !== ChannelType.GuildText) return interaction.reply({ content: "هذا الأمر يعمل فقط في الرومات النصية.", ephemeral: true });
        const amount = interaction.options.getInteger('amount')!;
        try {
          await interaction.channel.bulkDelete(amount, true);
          await interaction.reply({ content: `تم مسح ${amount} رسالة بنجاح ✅`, ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: "فشل مسح الرسائل.", ephemeral: true });
        }
      }

      if (commandName === 'setup-tickets') {
        const permissions = interaction.member?.permissions;
        if (!permissions || !(permissions instanceof PermissionsBitField) || !permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "تحتاج إلى صلاحيات Administrator لاستخدام هذا الأمر.", ephemeral: true });
        const role = interaction.options.getRole('role')!;
        const embed = new EmbedBuilder()
          .setTitle("نظام التذاكر")
          .setDescription("اضغط على الزر أدناه لفتح تذكرة والتحدث مع الدعم الفني.")
          .setColor(0x5865F2)
          .setTimestamp()
          .setFooter({ text: "نظام الدعم الفني" });
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilderClass()
            .setCustomId(`open_ticket:${role.id}`)
            .setLabel("الدعم الفني")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🎟️")
        );
        await interaction.channel?.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: "تم إعداد نظام التذاكر بنجاح ✅", ephemeral: true });
      }

      if (commandName === 'reset-server') {
        const guildMember = (interaction.member instanceof GuildMember) ? interaction.member : await interaction.guild?.members.fetch(user.id);
        if (!guildMember) return interaction.reply({ content: "فشل التحقق من العضو.", ephemeral: true });

        const isServerOwner = user.id === interaction.guild?.ownerId;
        const isAdmin = guildMember.permissions.has(PermissionFlagsBits.Administrator);
        const hasOwnerRole = guildMember.roles.cache.some(role => role.name === "Owner");
        if (!isServerOwner && !isAdmin && !hasOwnerRole) return interaction.reply({ content: "ليس لديك صلاحية لتصفير السيرفر.", ephemeral: true });
        
        await interaction.reply("جاري تصفير السيرفر... قد يستغرق هذا بعض الوقت.");
        // ... (Reset logic here, same as in messageCreate)
      }

      if (commandName === 'register-commands') {
        const isServerOwner = user.id === interaction.guild?.ownerId;
        const isAdmin = interaction.member?.permissions instanceof PermissionsBitField && interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isServerOwner && !isAdmin) return interaction.reply({ content: "هذا الأمر للمسؤولين فقط.", ephemeral: true });

        try {
          const commands = [
            new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
            new SlashCommandBuilder().setName('id').setDescription('عرض معلومات العضو')
              .addUserOption(o => o.setName('user').setDescription('العضو المراد عرض معلوماته').setRequired(false)),
            new SlashCommandBuilder().setName('alias').setDescription('إضافة اختصار لأمر')
              .addStringOption(o => o.setName('name').setDescription('الاسم الجديد للاختصار').setRequired(true))
              .addStringOption(o => o.setName('original').setDescription('الاسم الأصلي للأمر').setRequired(true)),
            new SlashCommandBuilder().setName('level').setDescription('Check your XP & level'),
            new SlashCommandBuilder().setName('mafia').setDescription('Start a Mafia game'),
            new SlashCommandBuilder().setName('roulette').setDescription('Play roulette with your XP')
              .addIntegerOption(option => option.setName('amount').setDescription('Amount to bet').setRequired(true)),
            new SlashCommandBuilder().setName('cut').setDescription('Random question/activity'),
            new SlashCommandBuilder().setName('add-cmd').setDescription('Add a custom command')
              .addStringOption(o => o.setName('name').setDescription('Command name').setRequired(true))
              .addStringOption(o => o.setName('reply').setDescription('Command reply').setRequired(true)),
            new SlashCommandBuilder().setName('edit-command').setDescription('Edit a command')
              .addStringOption(o => o.setName('old').setDescription('Old name').setRequired(true))
              .addStringOption(o => o.setName('new').setDescription('New name').setRequired(true)),
            new SlashCommandBuilder().setName('request').setDescription('Request a feature')
              .addStringOption(o => o.setName('feature').setDescription('Feature description').setRequired(true)),
            new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
              .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true)),
            new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
              .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true)),
            new SlashCommandBuilder().setName('mute').setDescription('Mute a member')
              .addUserOption(o => o.setName('user').setDescription('User to mute').setRequired(true)),
            new SlashCommandBuilder().setName('unmute').setDescription('Unmute a member')
              .addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),
            new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
              .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true)),
            new SlashCommandBuilder().setName('clear').setDescription('Clear messages')
              .addIntegerOption(o => o.setName('amount').setDescription('Amount to clear').setRequired(true)),
            new SlashCommandBuilder().setName('setup-tickets').setDescription('Setup ticket system')
              .addRoleOption(o => o.setName('role').setDescription('Role for tickets').setRequired(true)),
            new SlashCommandBuilder().setName('reset-server').setDescription('Reset server'),
            new SlashCommandBuilder().setName('register-commands').setDescription('Manually register slash commands'),
          ].map(command => command.toJSON());

          const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
          await rest.put(
            Routes.applicationCommands(client.user!.id),
            { body: commands },
          );
          await interaction.reply("✅ تم إعادة تسجيل الأوامر بنجاح!");
        } catch (err) {
          addLog(`Error re-registering commands: ${err}`);
          await interaction.reply("فشل إعادة تسجيل الأوامر.");
        }
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "join_mafia") {
        const channelId = interaction.channelId;
        const game = mafiaGames.get(channelId);
        if (!game) return interaction.reply({ content: "لا توجد لعبة نشطة حالياً.", ephemeral: true });

        if (game.players.includes(interaction.user.id)) {
          return interaction.reply({ content: "أنت منضم بالفعل!", ephemeral: true });
        }

        game.players.push(interaction.user.id);
        
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setDescription(`المضيف: <@${game.hostId}>\nاللاعبين المنضمين: ${game.players.length}\n\nاضغط على الزر أدناه للمشاركة!\nتحتاج اللعبة إلى 4 لاعبين على الأقل للبدء.`);

        await interaction.update({ embeds: [embed] });
        addLog(`${interaction.user.username} joined Mafia in ${channelId}`);
      } else if (interaction.customId === "start_mafia") {
        const channelId = interaction.channelId;
        const game = mafiaGames.get(channelId);
        if (!game) return interaction.reply({ content: "لا توجد لعبة نشطة حالياً.", ephemeral: true });

        if (interaction.user.id !== game.hostId) {
          return interaction.reply({ content: "المضيف فقط يمكنه بدء اللعبة.", ephemeral: true });
        }

        if (game.players.length < 4) {
          return interaction.reply({ content: "تحتاج إلى 4 لاعبين على الأقل للبدء.", ephemeral: true });
        }

        // Assign Roles
        const players = [...game.players].sort(() => Math.random() - 0.5);
        const roles: { [key: string]: string } = {};
        
        roles[players[0]] = "مافيا 🔪";
        roles[players[1]] = "طبيب 🧪";
        roles[players[2]] = "محقق 🔍";
        for (let i = 3; i < players.length; i++) {
          roles[players[i]] = "مواطن 👤";
        }

        // Notify Players
        for (const playerId of players) {
          try {
            const user = await client.users.fetch(playerId);
            await user.send(`🕵️ دورك في لعبة المافيا هو: **${roles[playerId]}**`);
          } catch (e) {
            addLog(`Could not DM player ${playerId}`);
          }
        }

        await interaction.update({ 
          content: "✅ بدأت اللعبة! تم إرسال الأدوار في الخاص 📩", 
          embeds: [], 
          components: [] 
        });
        
        mafiaGames.delete(channelId);
        addLog(`Mafia game started in ${channelId}`);
      } else if (interaction.customId.startsWith("open_ticket")) {
        const guild = interaction.guild;
        if (!guild) return;

        const roleId = interaction.customId.split(":")[1];
        const channelName = `ticket-${interaction.user.username}`.toLowerCase();
        
        try {
          const overwrites: any[] = [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: interaction.user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            },
          ];

          if (roleId) {
            overwrites.push({
              id: roleId,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            });
          }

          const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: overwrites,
          });

          const embed1 = new EmbedBuilder()
            .setTitle("التكت")
            .setDescription("يرجى انتظار مسؤولين التذكرة الرد عليك")
            .setThumbnail(guild.iconURL())
            .setColor(0x00BFFF);

          const embed2 = new EmbedBuilder()
            .setDescription("• **السبب**: .")
            .setColor(0x00BFFF)
            .setFooter({ text: `${guild.name}'s Tickets`, iconURL: guild.iconURL() || undefined })
            .setTimestamp();

          const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilderClass()
              .setCustomId("close_ticket")
              .setLabel("اغلاق")
              .setStyle(ButtonStyle.Danger)
              .setEmoji("🔒"),
            new ButtonBuilderClass()
              .setCustomId(`claim_ticket:${roleId}`)
              .setLabel("استلام")
              .setStyle(ButtonStyle.Success)
              .setEmoji("📌"),
            new ButtonBuilderClass()
              .setCustomId("call_owner")
              .setLabel("استدعاء الاونر")
              .setStyle(ButtonStyle.Primary)
              .setEmoji("📢"),
            new ButtonBuilderClass()
              .setCustomId("call_support")
              .setLabel("استدعاء السيبورت")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("🔔"),
            new ButtonBuilderClass()
              .setCustomId("call_admin")
              .setLabel("نداء الاداري")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("👤")
          );

          const selectMenu = new StringSelectMenuBuilderClass()
            .setCustomId("edit_ticket")
            .setPlaceholder("تعديل التذكرة")
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel("إضافة عضو")
                .setValue("add_member")
                .setEmoji("➕"),
              new StringSelectMenuOptionBuilder()
                .setLabel("إزالة عضو")
                .setValue("remove_member")
                .setEmoji("➖")
            );

          const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

          await ticketChannel.send({ 
            content: `${interaction.user} 『AO』| @! | <@&${roleId}>`,
            embeds: [embed1, embed2], 
            components: [row1, row2] 
          });
          
          await interaction.reply({ content: `تم إنشاء التذكرة بنجاح: ${ticketChannel}`, ephemeral: true });
          addLog(`Ticket created for ${interaction.user.username} with support role ${roleId}`);
        } catch (err: any) {
          addLog(`Error creating ticket: ${err.message}`);
          await interaction.reply({ content: "فشل إنشاء التذكرة. تأكد من أن لدي صلاحية 'Manage Channels'.", ephemeral: true });
        }
      } else if (interaction.customId === "call_owner") {
        await interaction.reply({ content: "تم إرسال نداء لمالك السيرفر 📢", ephemeral: true });
        addLog(`Owner called in ${interaction.channel?.name}`);
      } else if (interaction.customId === "call_support") {
        await interaction.reply({ content: "تم إرسال نداء لفريق الدعم 🔔", ephemeral: true });
        addLog(`Support called in ${interaction.channel?.name}`);
      } else if (interaction.customId === "call_admin") {
        await interaction.reply({ content: "تم إرسال نداء للإدارة 👤", ephemeral: true });
        addLog(`Admin called in ${interaction.channel?.name}`);
      } else if (interaction.customId.startsWith("claim_ticket")) {
        const roleId = interaction.customId.split(":")[1];
        const member = interaction.member as any;

        // Check if the user is the one who opened the ticket
        if (interaction.message.content.includes(interaction.user.id) && !interaction.message.content.includes(`<@&${roleId}>`)) {
          // Double check it's the opener mention at the start
          const openerMention = interaction.message.content.split(" ")[0];
          if (openerMention.includes(interaction.user.id)) {
            return interaction.reply({ content: "عذراً، لا يمكنك استلام تذكرة قمت بفتحها بنفسك.", ephemeral: true });
          }
        }

        const hasRole = roleId ? member.roles.cache.has(roleId) : false;
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasRole && !isAdmin) {
          return interaction.reply({ content: "عذراً، هذا الزر مخصص لفريق الدعم فقط.", ephemeral: true });
        }

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .addFields({ name: "المستلم", value: `${interaction.user}`, inline: true })
          .setColor(0xFFA500);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilderClass()
            .setCustomId("close_ticket")
            .setLabel("إغلاق التذكرة")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🔒")
        );

        await interaction.update({ 
          content: `تم استلام التذكرة بواسطة: ${interaction.user}`,
          embeds: [embed], 
          components: [row] 
        });

        addLog(`Ticket ${interaction.channel?.name} claimed by ${interaction.user.username}`);
      } else if (interaction.customId === "close_ticket") {
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) return;

        await interaction.reply("Closing ticket in 5 seconds...");
        addLog(`Ticket closed by ${interaction.user.username}`);
        
        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (err: any) {
            addLog(`Error deleting ticket channel: ${err.message}`);
          }
        }, 5000);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "edit_ticket") {
        await interaction.reply({ content: "هذه الميزة قيد التطوير 🛠️", ephemeral: true });
      }
    }
  });

  // API Routes
  app.get("/api/auth/discord", passport.authenticate('discord'));
  
  app.get("/api/auth/callback", passport.authenticate('discord', {
    failureRedirect: '/'
  }), (req, res) => {
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  });

  app.get("/api/auth/me", (req, res) => {
    res.json(req.user || null);
  });

  app.get("/api/auth/logout", (req, res) => {
    req.logout(() => {
      res.redirect('/');
    });
  });

  app.get("/api/status", (req, res) => {
    res.json({
      status: botStatus,
      user: client.user?.tag || null,
      lastMessage,
      logs,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
