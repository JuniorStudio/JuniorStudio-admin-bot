const http = require('http');

// --- PROSTY SERWER HTTP + AUTO-BUDZIK DLA RENDER ---
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('JuniorStudio Bot is running 24/7!');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Serwer HTTP nasłuchuje na porcie ${PORT}`);
});

// Auto-pinger zapobiegający uśpieniu na Renderze (co 9 minut)
setInterval(() => {
  const appUrl = 'https://juniorstudio-admin-bot.onrender.com';
  http.get(appUrl, (res) => {
    console.log(`⏰ Pinger wybudził serwer. Status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error('⚠️ Błąd pingera:', err.message);
  });
}, 9 * 60 * 1000);

// --- GŁÓWNY KOD BOTA DISCORDA ---
require('dotenv').config();
const {  
  Client,  
  GatewayIntentBits,  
  Partials,  
  REST,  
  Routes,  
  SlashCommandBuilder,  
  PermissionFlagsBits,  
  EmbedBuilder,
  AuditLogEvent  
} = require('discord.js');
const fs = require('fs');
const cron = require('node-cron');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Pliki bazy danych JSON
const WARNINGS_FILE = './warnings.json';
const NOTES_FILE = './notes.json';
const ACTIVITY_FILE = './daily_activity.json';

function loadData(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Helper do czasu (10m, 2h, 1d)
function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([mhd])$/);
  if (!match) return null;
   
  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

client.once('ready', async () => {
  console.log(`🔥 Bot wystartował jako ${client.user.tag}!`);

  // --- AUTOMATYZACJA: Codziennie o 22:00 (Top 5 aktywności) ---
  cron.schedule('0 22 * * *', async () => {
    try {
      const channelId = process.env.DAILY_CHANNEL_ID;
      if (!channelId) {
        console.log('❌ Brak zdefiniowanego DAILY_CHANNEL_ID w pliku .env!');
        return;
      }

      const channel = client.channels.cache.get(channelId);
      if (!channel) {
        console.log('❌ Nie znaleziono kanału do wysyłania codziennej topki.');
        return;
      }

      const activityData = loadData(ACTIVITY_FILE);
       
      if (Object.keys(activityData).length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setTitle('🏆 Top 5 najbardziej piszących (daily)')
          .setColor(0x9B59B6)
          .setDescription('Nikt dziś nie napisał żadnej wiadomości!')
          .setTimestamp();
          
        await channel.send({ embeds: [emptyEmbed] });
        return;
      }

      const sortedUsers = Object.entries(activityData)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      let descriptionText = '';
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

      sortedUsers.forEach(([userId, count], index) => {
        const medal = medals[index] || `${index + 1}.`;
        descriptionText += `${medal} <@${userId}> – **${count}** ${count === 1 ? 'wiadomość' : 'wiadomości'}\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 Top 5 najbardziej piszących (daily)')
        .setColor(0x9B59B6)
        .setDescription(descriptionText)
        .setFooter({ text: 'Pisz i zobacz się na liście!' })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      console.log('✅ Wysłano dzienne podsumowanie Top 5!');

      saveData(ACTIVITY_FILE, {});
    } catch (err) {
      console.error('❌ Błąd podczas wysyłania codziennej topki:', err);
    }
  }, {
    timezone: "Europe/Warsaw"
  });

  // Rejestracja komend Slash
  const warnCommand = new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Nadaje ostrzeżenie użytkownikowi')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba, która otrzyma warn').setRequired(true))
    .addIntegerOption(option => option.setName('punkty').setDescription('Ilość punktów ostrzeżenia').setRequired(true))
    .addStringOption(option => option.setName('powod').setDescription('Powód nadania warna').setRequired(true));

  const clearWarnCommand = new SlashCommandBuilder()
    .setName('clearwarn')
    .setDescription('Usuwa punkty ostrzeżeń użytkownikowi')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba, której chcesz usunąć punkty').setRequired(true))
    .addIntegerOption(option => option.setName('punkty').setDescription('Ilość punktów do usunięcia').setRequired(true));

  const warnsCommand = new SlashCommandBuilder()
    .setName('warns')
    .setDescription('Sprawdza liczbę punktów ostrzeżeń użytkownika')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba, której punkty chcesz sprawdzić').setRequired(true));

  const historiaCommand = new SlashCommandBuilder()
    .setName('historia')
    .setDescription('Pokazuje pełną historię ostrzeżeń użytkownika')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba, której historię chcesz sprawdzić').setRequired(true));

  const clearHistoriaCommand = new SlashCommandBuilder()
    .setName('clearhistoria')
    .setDescription('Usuwa historię ostrzeżeń użytkownika z opcją resetu punktów')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba, której historię chcesz wyczyścić').setRequired(true))
    .addStringOption(option => 
      option.setName('usun_pkt')
        .setDescription('Czy usunąć również wszystkie punkty warn?')
        .setRequired(true)
        .addChoices(
          { name: 'Tak', value: 'tak' },
          { name: 'Nie', value: 'nie' }
        ));

  const muteCommand = new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Wycisza użytkownika na określony czas')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba do wyciszenia').setRequired(true))
    .addStringOption(option => option.setName('czas').setDescription('Np. 10m (minuty), 2h (godziny), 1d (dni)').setRequired(true))
    .addStringOption(option => option.setName('powod').setDescription('Powód wyciszenia').setRequired(true));

  const unmuteCommand = new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Zdejmuje wyciszenie z użytkownika')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba do odwyciszenia').setRequired(true));

  const noteCommand = new SlashCommandBuilder()
    .setName('notatka')
    .setDescription('Dodaje poufną notatkę administracyjną o użytkowniku')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Użytkownik, którego dotyczy notatka').setRequired(true))
    .addStringOption(option => option.setName('tresc').setDescription('Treść notatki').setRequired(true));

  const readNoteCommand = new SlashCommandBuilder()
    .setName('czytaj-notatke')
    .setDescription('Wyświetla notatki administracyjne o użytkowniku')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Użytkownik, którego notatki chcesz sprawdzić').setRequired(true));

  const banCommand = new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Banuje użytkownika na serwerze')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option => option.setName('uzytkownik').setDescription('Osoba do zbanowania').setRequired(true))
    .addStringOption(option => option.setName('powod').setDescription('Powód bana').setRequired(true));

  const unbanCommand = new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Odbanowuje użytkownika po ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(option => option.setName('uzytkownik').setDescription('ID użytkownika do odbanowania').setRequired(true));

  const clearCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Usuwa określoną liczbę wiadomości na kanale')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option => option.setName('ilosc').setDescription('Liczba wiadomości do usunięcia (1-100)').setRequired(true));

  const embedCommand = new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Tworzy i wysyła ładny komunikat typu Embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(option => 
      option.setName('tresc')
        .setDescription('Treść ogłoszenia')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('tytul')
        .setDescription('Tytuł embeda (opcjonalnie)')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('kolor')
        .setDescription('Kolor ramki (np. red, green, blue, yellow lub hex np. #9B59B6)')
        .setRequired(false))
    .addChannelOption(option => 
      option.setName('kanal')
        .setDescription('Kanał, na który ma trafić ogłoszenie (domyślnie obecny)')
        .setRequired(false));

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    console.log('Rejestrowanie komend slash...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [
        warnCommand.toJSON(), 
        clearWarnCommand.toJSON(), 
        warnsCommand.toJSON(), 
        historiaCommand.toJSON(), 
        clearHistoriaCommand.toJSON(),
        muteCommand.toJSON(),
        unmuteCommand.toJSON(),
        noteCommand.toJSON(),
        readNoteCommand.toJSON(),
        banCommand.toJSON(), 
        unbanCommand.toJSON(), 
        clearCommand.toJSON(),
        embedCommand.toJSON()
      ] },
    );
    console.log('✅ Pomyślnie zarejestrowano wszystkie komendy!');
  } catch (error) {
    console.error('Błąd podczas rejestrowania komend:', error);
  }
});

// Obsługa interakcji (Komendy Slash)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const punishmentsChannelId = process.env.PUNISHMENTS_CHANNEL_ID;
  const channel = punishmentsChannelId ? interaction.guild.channels.cache.get(punishmentsChannelId) : null;

  if (interaction.commandName === 'warn') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const points = interaction.options.getInteger('punkty');
    const reason = interaction.options.getString('powod');
    const moderator = interaction.user;

    const warnings = loadData(WARNINGS_FILE);
    if (!warnings[targetUser.id]) {
      warnings[targetUser.id] = { totalPoints: 0, history: [] };
    }

    const timestamp = new Date().toLocaleString();
    warnings[targetUser.id].totalPoints += points;
    warnings[targetUser.id].history.push({
      type: 'WARN',
      points,
      reason,
      moderator: moderator.tag,
      date: timestamp
    });

    saveData(WARNINGS_FILE, warnings);

    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Ostrzeżenie dla: ${targetUser.username}`)
        .setColor(0x9B59B6)
        .setDescription(
          `» **Punkty:** +${points}\n` +
          `» **Razem punktów:** ${warnings[targetUser.id].totalPoints}\n` +
          `» **Powód:** ${reason}\n` +
          `» **Moderator:** <@${moderator.id}>`
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }

    await interaction.reply({ content: `✅ Pomyślnie nałożono ostrzeżenie.`, ephemeral: true });
  }

  if (interaction.commandName === 'clearwarn') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const pointsToRemove = interaction.options.getInteger('punkty');
    const moderator = interaction.user;

    const warnings = loadData(WARNINGS_FILE);
    if (!warnings[targetUser.id] || warnings[targetUser.id].totalPoints <= 0) {
      return interaction.reply({ content: `❌ Użytkownik nie ma punktów do usunięcia.`, ephemeral: true });
    }

    const previousPoints = warnings[targetUser.id].totalPoints;
    warnings[targetUser.id].totalPoints = Math.max(0, previousPoints - pointsToRemove);
    const actualRemoved = previousPoints - warnings[targetUser.id].totalPoints;
    const timestamp = new Date().toLocaleString();

    warnings[targetUser.id].history.push({
      type: 'CLEAR',
      pointsRemoved: actualRemoved,
      moderator: moderator.tag,
      date: timestamp
    });

    saveData(WARNINGS_FILE, warnings);
    await interaction.reply({ content: `✅ Usunięto punkty.`, ephemeral: true });
  }

  if (interaction.commandName === 'warns') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const warnings = loadData(WARNINGS_FILE);
    const userWarnings = warnings[targetUser.id] ? warnings[targetUser.id].totalPoints : 0;

    const embed = new EmbedBuilder()
      .setTitle(`📋 Ostrzeżenia użytkownika: ${targetUser.username}`)
      .setColor(0x9B59B6)
      .setDescription(`» **Aktualne punkty:** ${userWarnings}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'historia') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const warnings = loadData(WARNINGS_FILE);
    const userData = warnings[targetUser.id];

    if (!userData || !userData.history || userData.history.length === 0) {
      return interaction.reply({ content: `📁 Brak historii ostrzeżeń.`, ephemeral: true });
    }

    let historyText = userData.history.map((entry, index) => {
      if (entry.type === 'WARN') {
        return `**${index + 1}.** [${entry.date}] ⚠️ **+${entry.points} pkt**\n• Powód: *${entry.reason}*\n• Moderator: ${entry.moderator}`;
      } else {
        return `**${index + 1}.** [${entry.date}] 🧹 **-${entry.pointsRemoved} pkt**\n• Moderator: ${entry.moderator}`;
      }
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`📜 Historia kar: ${targetUser.username}`)
      .setColor(0x9B59B6)
      .setDescription(historyText)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'clearhistoria') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const clearPointsOption = interaction.options.getString('usun_pkt');

    const warnings = loadData(WARNINGS_FILE);
    if (!warnings[targetUser.id]) {
      return interaction.reply({ content: `❌ Brak danych w bazie.`, ephemeral: true });
    }

    warnings[targetUser.id].history = [];
    if (clearPointsOption === 'tak') warnings[targetUser.id].totalPoints = 0;
    saveData(WARNINGS_FILE, warnings);

    await interaction.reply({ content: `✅ Wyczyszczono historię użytkownika.`, ephemeral: true });
  }

  if (interaction.commandName === 'mute') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const durationStr = interaction.options.getString('czas');
    const reason = interaction.options.getString('powod');
    const msDuration = parseDuration(durationStr);

    if (!msDuration) return interaction.reply({ content: `❌ Błędny format czasu (np. 10m, 2h, 1d).`, ephemeral: true });

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(msDuration, reason);
      await interaction.reply({ content: `✅ Wyciszono użytkownika.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Nie udało się wyciszyć.`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'unmute') {
    const targetUser = interaction.options.getUser('uzytkownik');
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(null, 'Zdjęcie wyciszenia');
      await interaction.reply({ content: `✅ Zdjęto wyciszenie.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Błąd.`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'notatka') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const noteContent = interaction.options.getString('tresc');
    const notes = loadData(NOTES_FILE);
    if (!notes[targetUser.id]) notes[targetUser.id] = [];

    notes[targetUser.id].push({ content: noteContent, moderator: interaction.user.tag, date: new Date().toLocaleString() });
    saveData(NOTES_FILE, notes);
    await interaction.reply({ content: `📝 Dodano notatkę.`, ephemeral: true });
  }

  if (interaction.commandName === 'czytaj-notatke') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const notes = loadData(NOTES_FILE);
    const userNotes = notes[targetUser.id];

    if (!userNotes || userNotes.length === 0) return interaction.reply({ content: `📂 Brak notatek.`, ephemeral: true });

    let notesText = userNotes.map((note, index) => `**${index + 1}.** [${note.date}] (Mod: ${note.moderator})\n• *${note.content}*`).join('\n\n');
    const embed = new EmbedBuilder().setTitle(`📒 Notatki: ${targetUser.username}`).setColor(0x9B59B6).setDescription(notesText);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'ban') {
    const targetUser = interaction.options.getUser('uzytkownik');
    const reason = interaction.options.getString('powod');
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.ban({ reason });
      await interaction.reply({ content: `✅ Zbanowano.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Błąd bana.`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'unban') {
    const userId = interaction.options.getString('uzytkownik');
    try {
      await interaction.guild.members.unban(userId);
      await interaction.reply({ content: `✅ Odbanowano.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Nie znaleziono ID.`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'clear') {
    const amount = interaction.options.getInteger('ilosc');
    if (amount < 1 || amount > 100) return interaction.reply({ content: `❌ Podaj liczbę od 1 do 100.`, ephemeral: true });

    try {
      await interaction.deferReply({ ephemeral: true });
      const messages = await interaction.channel.messages.fetch({ limit: amount });
      const deleted = await interaction.channel.bulkDelete(messages, true);
      await interaction.editReply({ content: `🧹 Usunięto ${deleted.size} wiadomości.` });
    } catch (err) {
      await interaction.editReply({ content: `❌ Błąd podczas usuwania wiadomości.` });
    }
  }

  if (interaction.commandName === 'embed') {
    const text = interaction.options.getString('tresc');
    const title = interaction.options.getString('tytul') || '📢 Ogłoszenie';
    const colorInput = interaction.options.getString('kolor');
    const targetChannel = interaction.options.getChannel('kanal') || interaction.channel;

    let embedColor = 0x9B59B6;
    if (colorInput) {
      const lowerColor = colorInput.toLowerCase();
      if (lowerColor === 'red' || lowerColor === 'czerwony') embedColor = 0xE74C3C;
      else if (lowerColor === 'green' || lowerColor === 'zielony') embedColor = 0x2ECC71;
      else if (lowerColor === 'blue' || lowerColor === 'niebieski') embedColor = 0x3498DB;
      else if (lowerColor === 'yellow' || lowerColor === 'zolty') embedColor = 0xF1C40F;
      else if (lowerColor.startsWith('#')) {
        embedColor = parseInt(colorInput.replace('#', ''), 16);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(text)
      .setColor(embedColor)
      .setTimestamp()
      .setFooter({ text: `Wysłane przez: ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

    try {
      await targetChannel.send({ embeds: [embed] });
      await interaction.reply({ content: `✅ Pomyślnie wysłano embed na kanał <#${targetChannel.id}>!`, ephemeral: true });
    } catch (err) {
      console.error('❌ Błąd podczas wysyłania embeda:', err);
      await interaction.reply({ content: `❌ Wystąpił błąd podczas wysyłania wiadomości (sprawdź uprawnienia bota na tamtym kanale).`, ephemeral: true });
    }
  }
});

// Nasłuchiwanie nowych wiadomości
client.on('messageCreate', async message => {
  try {
    if (!message.guild || message.author.bot) return;

    // 1. Zliczanie wiadomości do rankingu Daily
    const activityData = loadData(ACTIVITY_FILE);
    if (!activityData[message.author.id]) activityData[message.author.id] = 0;
    activityData[message.author.id] += 1;
    saveData(ACTIVITY_FILE, activityData);

    // 2. Pułapka Toadstool
    if (process.env.TOADSTOOL_CHANNEL_ID && message.channel.id === process.env.TOADSTOOL_CHANNEL_ID) {
      const member = await message.guild.members.fetch(message.author.id);
      if (member && member.bannable) {
        await member.ban({ reason: 'Złapany w kanał-pułapkę (Toadstool)' });
      }
    }
  } catch (err) {
    console.error('❌ Błąd messageCreate:', err);
  }
});

// --- SYSTEM LOGÓW: EDYCJA WIADOMOŚCI ---
client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;

    const logsChannelId = process.env.LOGS_CHANNEL_ID;
    if (!logsChannelId) return;

    const channel = newMessage.guild.channels.cache.get(logsChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('✏️ Edytowano wiadomość')
      .setColor(0xF1C40F)
      .setDescription(`**Autor:** <@${newMessage.author.id}> (\`${newMessage.author.tag}\`)\n**Kanał:** <#${newMessage.channel.id}>`)
      .addFields(
        { name: 'Przed edycją:', value: oldMessage.content ? (oldMessage.content.length > 1024 ? oldMessage.content.substring(0, 1021) + '...' : oldMessage.content) : '*Brak tekstu*' },
        { name: 'Po edycji:', value: newMessage.content ? (newMessage.content.length > 1024 ? newMessage.content.substring(0, 1021) + '...' : newMessage.content) : '*Brak tekstu*' }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Błąd logów edycji:', err);
  }
});

// --- SYSTEM LOGÓW: USUNIĘCIE WIADOMOŚCI (Z WYKRYCIEM KTO USUNĄŁ) ---
client.on('messageDelete', async (message) => {
  try {
    if (!message.guild || message.author?.bot) return;

    const logsChannelId = process.env.LOGS_CHANNEL_ID;
    if (!logsChannelId) return;

    const channel = message.guild.channels.cache.get(logsChannelId);
    if (!channel) return;

    let deleterText = message.author ? `<@${message.author.id}> (sam usunął swoją wiadomość)` : 'Nieznany użytkownik';

    try {
      const fetchedLogs = await message.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MessageDelete,
      });
      const deletionLog = fetchedLogs.entries.first();

      if (deletionLog) {
        const { executor, target, createdTimestamp } = deletionLog;
        const timeAgo = Date.now() - createdTimestamp;
         
        if (target && target.id === message.author?.id && timeAgo < 5000) {
          deleterText = `<@${executor.id}> (\`${executor.tag}\`)`;
        }
      }
    } catch (e) {
      // Ignorujemy brak uprawnień do audit logów
    }

    const authorText = message.author ? `<@${message.author.id}> (\`${message.author.tag}\`)` : 'Nieznany użytkownik';
    const contentText = message.content ? (message.content.length > 1024 ? message.content.substring(0, 1021) + '...' : message.content) : '*Brak tekstu (np. po restarcie bota)*';

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Usunięto wiadomość')
      .setColor(0xE74C3C)
      .setDescription(
        `**Autor wiadomości:** ${authorText}\n` +
        `**Kto usunął:** ${deleterText}\n` +
        `**Kanał:** <#${message.channel.id}>`
      )
      .addFields(
        { name: 'Treść usuniętej wiadomości:', value: contentText }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Błąd w logach usuwania wiadomości:', err);
  }
});

client.login(process.env.TOKEN);
