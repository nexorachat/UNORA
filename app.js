(() => {
  "use strict";

  const config = window.UNORA_CONFIG || {};
  const hasConfig = config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_URL.includes("TU-PROYECTO") &&
    !config.SUPABASE_ANON_KEY.includes("TU_CLAVE");

  const db = hasConfig && window.supabase
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;

  const $ = (id) => document.getElementById(id);
  const screens = ["welcome", "signup", "login", "profile-setup", "moments"];
  let currentProfile = null;
  let currentTab = "feed";
  let toastTimer;

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function showMessage(id, message, error = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.style.color = error ? "#ff8ca5" : "#a9b9ff";
  }

  function showScreen(name) {
    screens.forEach((id) => $(id).classList.toggle("hidden", id !== name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setBusy(form, busy) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    button.dataset.originalText ||= button.textContent;
    button.textContent = busy ? "Un momento..." : button.dataset.originalText;
  }

  function friendlyError(error) {
    const msg = String(error?.message || "Ha ocurrido un error.");
    if (/invalid login credentials/i.test(msg)) return "Correo o contraseña incorrectos.";
    if (/already registered/i.test(msg)) return "Este correo ya tiene una cuenta. Prueba a iniciar sesión.";
    if (/username|profiles_username/i.test(msg)) return "Ese nombre de usuario ya está ocupado.";
    if (/email not confirmed/i.test(msg)) return "Confirma tu correo electrónico antes de iniciar sesión.";
    return msg;
  }

  async function getProfile() {
    if (!db) return null;
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return null;

    const { data, error } = await db
      .from("profiles")
      .select("id, username, display_name, bio, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error(error);
      return null;
    }
    return data;
  }

  async function enterApp() {
    if (!db) {
      showScreen("welcome");
      toast("Conecta Supabase en config.js para activar las cuentas.");
      return;
    }

    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      showScreen("welcome");
      return;
    }

    currentProfile = await getProfile();
    if (!currentProfile) {
      $("profile-name").value = user.user_metadata?.display_name || "";
      showScreen("profile-setup");
      return;
    }

    updateComposerAvatar();
    showScreen("moments");
    await loadFeed();
  }

  function updateComposerAvatar() {
    const avatar = $("composer-avatar");
    if (!avatar || !currentProfile) return;
    if (currentProfile.avatar_url) {
      avatar.style.backgroundImage = `url("${currentProfile.avatar_url}")`;
      avatar.textContent = "";
    } else {
      avatar.style.backgroundImage = "";
      avatar.textContent = (currentProfile.display_name || "U").slice(0, 1).toUpperCase();
    }
  }

  document.addEventListener("click", async (event) => {
    const go = event.target.closest("[data-go]");
    const tab = event.target.closest("[data-tab]");
    const home = event.target.closest("[data-home], [data-app-home]");

    if (go) {
      showScreen(go.dataset.go);
      return;
    }

    if (home) {
      if (home.hasAttribute("data-app-home")) {
        currentTab = "feed";
        updateTab();
        await loadFeed();
      } else {
        showScreen("welcome");
      }
      return;
    }

    if (tab) {
      currentTab = tab.dataset.tab;
      updateTab();
      if (currentTab === "feed") await loadFeed();
      else renderTab(currentTab);
    }
  });

  $("signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = $("signup-name").value.trim();
    const email = $("signup-email").value.trim();
    const password = $("signup-password").value;

    if (!db) {
      showMessage("signup-message", "Primero configura config.js y la base de datos Supabase.", true);
      return;
    }

    setBusy(form, true);
    showMessage("signup-message", "");
    try {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } }
      });
      if (error) throw error;

      if (data.session) {
        $("profile-name").value = name;
        showScreen("profile-setup");
      } else {
        showMessage("signup-message", "Revisa tu correo para confirmar la cuenta. Después inicia sesión.");
      }
    } catch (error) {
      showMessage("signup-message", friendlyError(error), true);
    } finally {
      setBusy(form, false);
    }
  });

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!db) {
      showMessage("login-message", "Primero configura config.js y Supabase.", true);
      return;
    }

    setBusy(form, true);
    showMessage("login-message", "");
    try {
      const { error } = await db.auth.signInWithPassword({
        email: $("login-email").value.trim(),
        password: $("login-password").value
      });
      if (error) throw error;
      await enterApp();
    } catch (error) {
      showMessage("login-message", friendlyError(error), true);
    } finally {
      setBusy(form, false);
    }
  });

  $("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!db) {
      showMessage("profile-message", "Conecta Supabase para guardar tu perfil.", true);
      return;
    }

    const username = $("profile-username").value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      showMessage("profile-message", "Usa entre 3 y 24 letras, números o guiones bajos.", true);
      return;
    }

    setBusy(form, true);
    try {
      const { data: { user }, error: userError } = await db.auth.getUser();
      if (userError || !user) throw userError || new Error("Inicia sesión de nuevo.");

      const profile = {
        id: user.id,
        username,
        display_name: $("profile-name").value.trim(),
        bio: $("profile-bio").value.trim(),
        avatar_url: $("profile-avatar").value.trim() || null,
        updated_at: new Date().toISOString()
      };

      const { error } = await db.from("profiles").upsert(profile);
      if (error) throw error;

      currentProfile = profile;
      updateComposerAvatar();
      showScreen("moments");
      await loadFeed();
      toast("¡Bienvenido a UNORA MOMENTS!");
    } catch (error) {
      showMessage("profile-message", friendlyError(error), true);
    } finally {
      setBusy(form, false);
    }
  });

  async function loadFeed() {
    if (!db) {
      $("feed-list").innerHTML = "";
      $("empty-feed").classList.remove("hidden");
      $("empty-feed").querySelector("h3").textContent = "Conecta tu comunidad";
      $("empty-feed").querySelector("p").textContent =
        "Configura Supabase para guardar y mostrar publicaciones reales.";
      return;
    }

    const { data, error } = await db
      .from("posts")
      .select("id, content, created_at, profiles(username, display_name, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error(error);
      toast("No se pudo cargar el feed. Comprueba la configuración de Supabase.");
      return;
    }

    const list = $("feed-list");
    list.replaceChildren();
    $("empty-feed").classList.toggle("hidden", data.length > 0);

    for (const post of data) {
      const card = document.createElement("article");
      card.className = "post-card";

      const top = document.createElement("div");
      top.className = "post-top";

      const avatar = document.createElement("div");
      avatar.className = "composer-avatar";
      if (post.profiles?.avatar_url) {
        avatar.style.backgroundImage = `url("${post.profiles.avatar_url}")`;
      } else {
        avatar.textContent = (post.profiles?.display_name || "U").slice(0, 1).toUpperCase();
      }

      const user = document.createElement("div");
      user.className = "post-user";
      const name = document.createElement("b");
      name.textContent = post.profiles?.display_name || "Usuario UNORA";
      const handle = document.createElement("span");
      handle.textContent = "@" + (post.profiles?.username || "usuario") + " · " +
        new Date(post.created_at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
      user.append(name, handle);
      top.append(avatar, user);

      const content = document.createElement("p");
      content.className = "post-content";
      content.textContent = post.content;

      const actions = document.createElement("div");
      actions.className = "post-actions";
      const comment = document.createElement("button");
      comment.textContent = "♡  Me gusta";
      comment.type = "button";
      comment.addEventListener("click", () => toast("Los me gusta se activarán en la siguiente fase."));
      const reply = document.createElement("button");
      reply.textContent = "○  Comentar";
      reply.type = "button";
      reply.addEventListener("click", () => toast("Los comentarios se activarán en la siguiente fase."));
      const share = document.createElement("button");
      share.textContent = "↗  Compartir";
      share.type = "button";
      share.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(post.content);
          toast("Texto copiado para compartir.");
        } catch {
          toast("No se pudo copiar el texto.");
        }
      });
      actions.append(comment, reply, share);
      card.append(top, content, actions);
      list.append(card);
    }
  }

  $("post-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!db) {
      showMessage("post-message", "Conecta Supabase para publicar.", true);
      return;
    }

    const content = $("post-text").value.trim();
    if (!content) return;

    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Inicia sesión para publicar.");

      const { error } = await db.from("posts").insert({
        user_id: user.id,
        content
      });
      if (error) throw error;

      $("post-text").value = "";
      showMessage("post-message", "");
      await loadFeed();
      toast("Tu momento ya está publicado.");
    } catch (error) {
      showMessage("post-message", friendlyError(error), true);
    } finally {
      button.disabled = false;
    }
  });

  function updateTab() {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === currentTab);
    });

    const titles = {
      feed: "UNORA MOMENTS",
      discover: "DESCUBRIR",
      videos: "UNORA VIDEOS",
      awards: "UNORA AWARDS",
      "my-profile": "MI PERFIL"
    };
    $("feed-title").textContent = titles[currentTab] || "UNORA MOMENTS";
  }

  function renderTab(tab) {
    const list = $("feed-list");
    list.replaceChildren();
    $("empty-feed").classList.add("hidden");

    const info = {
      discover: ["Descubre nuevas historias", "La sección para encontrar personas y momentos de todo el mundo."],
      videos: ["UNORA Videos", "Aquí irá el feed de vídeos verticales. La subida y reproducción se añadirán en la siguiente fase."],
      awards: ["Los ocho premios de UNORA", "STAR · CONNECT · CREATOR · COMMUNITY · VIRAL · IMPACT · LEGEND · DISCOVERY"],
      "my-profile": [
        currentProfile?.display_name || "Tu perfil",
        "@" + (currentProfile?.username || "usuario") + "\n" + (currentProfile?.bio || "Tu espacio en UNORA.")
      ]
    };

    const [title, description] = info[tab] || ["UNORA MOMENTS", "Tu mundo. Tu gente."];
    const card = document.createElement("article");
    card.className = "post-card";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const body = document.createElement("p");
    body.className = "post-content";
    body.textContent = description;
    card.append(heading, body);
    list.append(card);
  }

  $("logout-button").addEventListener("click", async () => {
    if (!db) {
      showScreen("welcome");
      return;
    }
    const { error } = await db.auth.signOut();
    if (error) {
      toast("No se pudo cerrar sesión.");
      return;
    }
    currentProfile = null;
    showScreen("welcome");
    toast("Has cerrado sesión.");
  });

  // Recuperar sesión después de recargar la página.
  if (db) {
    db.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentProfile = null;
        showScreen("welcome");
      } else if (event === "SIGNED_IN" && session) {
        setTimeout(() => enterApp(), 0);
      }
    });

    db.auth.getSession().then(({ data }) => {
      if (data.session) enterApp();
    });
  }
})();
