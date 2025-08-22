import { Client, GatewayIntentBits } from "discord.js";
import fetch from "node-fetch";
import cloudinary from "cloudinary";

const {
  DISCORD_TOKEN,
  CHANNEL_ID,
  MOD_ROLE_ID,
  CLOUD_NAME, API_KEY, API_SECRET,
  GIST_ID, GIST_TOKEN
} = process.env;

// Cloudinary config
cloudinary.v2.config({ cloud_name: CLOUD_NAME, api_key: API_KEY, api_secret: API_SECRET });

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Gist helpers
const GIST_API = (id) => `https://api.github.com/gists/${id}`;
async function getList() {
  const r = await fetch(GIST_API(GIST_ID), { headers: { Authorization: `token ${GIST_TOKEN}` }});
  const g = await r.json();
  const key = Object.keys(g.files)[0];
  return { key, json: JSON.parse(g.files[key].content) };
}
async function saveList(json) {
  const { key } = await getList();
  await fetch(GIST_API(GIST_ID), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `token ${GIST_TOKEN}` },
    body: JSON.stringify({ files: { [key]: { content: JSON.stringify(json, null, 2) }}})
  });
}

function isMod(member) {
  if (!MOD_ROLE_ID) return true;
  return member.roles.cache.has(MOD_ROLE_ID);
}

async function uploadToCloudinary(url) {
  const res = await cloudinary.v2.uploader.upload(url, { resource_type: "auto", folder: "stream_memes" });
  return { url: res.secure_url, public_id: res.public_id };
}

client.once("ready", () => console.log(`Bot conectado como ${client.user.tag}`));

client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (CHANNEL_ID && msg.channelId !== CHANNEL_ID) return;

    const content = (msg.content || "").trim().toLowerCase();

    // Test
    if (content === "!ping") return void msg.reply("Pong 🏓");

    // !aprobado
    if (content.startsWith("!aprobado")) {
      if (!isMod(msg.member)) return void msg.reply("Solo mods pueden aprobar.");

      let target = msg.reference ? await msg.channel.messages.fetch(msg.reference.messageId) : null;
      let url = null;

      if (target?.attachments?.size) {
        const first = target.attachments.first();
        if (first?.contentType?.startsWith("image/")) url = first.url;
      }
      if (!url && target?.content) {
        const m = target.content.match(/https?:\/\/\S+/);
        if (m) url = m[0];
      }
      if (!url && content !== "!aprobado") {
        const parts = msg.content.split(/\s+/);
        if (parts[1]?.startsWith("http")) url = parts[1];
      }
      if (!url) return void msg.reply("No encontré imagen/URL en el reply o comando.");

      const up = await uploadToCloudinary(url);
      const store = await getList();
      store.json.memes.push({ url: up.url, public_id: up.public_id, at: new Date().toISOString() });
      await saveList(store.json);

      return void msg.reply(`✅ Aprobado y publicado.`);
    }

    // !borrar
    if (content.startsWith("!borrar")) {
      if (!isMod(msg.member)) return void msg.reply("Solo mods pueden borrar.");

      const parts = msg.content.split(/\s+/);
      const store = await getList();
      let idx = parts[1] ? Number(parts[1]) : store.json.memes.length - 1;
      if (isNaN(idx) || idx < 0 || idx >= store.json.memes.length) {
        return void msg.reply("Índice inválido.");
      }
      const item = store.json.memes[idx];

      if (item.public_id) {
        await cloudinary.v2.uploader.destroy(item.public_id, { resource_type: "auto" });
      }
      store.json.memes.splice(idx, 1);
      await saveList(store.json);

      return void msg.reply("🗑️ Borrado del overlay.");
    }

    // !lista
    if (content.startsWith("!lista")) {
      const store = await getList();
      const n = store.json.memes.length;
      const sample = store.json.memes.slice(-3).map(m => m.url).join("\n");
      return void msg.reply(`Hay ${n} memes en rotación.\n${sample || "(sin muestras)"}`);
    }

  } catch (e) {
    console.error(e);
    try { await msg.reply("Hubo un error procesando el comando."); } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
