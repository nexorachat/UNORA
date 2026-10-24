(() => {
  "use strict";

  const cfg = window.UNORA_CONFIG || {};
  const ready = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase;
  const db = ready ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const $ = (id) => document.getElementById(id);
  const redirectTo = location.origin + location.pathname;
  const state = { user: null, profile: null };

  function say(id, text, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "#ff8ca5" : "#a9b9ff";
  }

  function busy(form, on) {
    const b = form.querySelector('button[type="submit"]');
    if (!b) return;
    b.dataset.t ||= b.textContent;
    b.disabled = on;
    b.textContent = on ? "Un momento..." : b.dataset.t;
  }

  function friendly(error) {
    const m = String(error?.message || "");
    if (/invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
    if (/already registered|already been registered/i.test(m)) return "Ese correo ya tiene cuenta. Prueba a iniciar sesión.";
    if (/email not confirmed/i.test(m)) return "Confirma tu correo antes de iniciar sesión. Revisa también el spam.";
    if (/password should be at least/i.test(m)) return "La contraseña debe tener al menos 8 caracteres.";
    if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espera unos minutos.";
    if (/duplicate|unique|23505/i.test(m) || error?.code === "23505") return "Ese nombre de usuario ya está ocupado.";
    console.error(error);
    return "No se pudo completar: " + (m || "error desconocido");
  }

  const initial = (name) => (name || "U").trim().slice(0, 1).toUpperCase();
  const when = (iso) => new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });

  /* ---------- Acceso (pestañas) ---------- */
  function showTab(name) {
    ["signup", "login"].forEach((n) => { $(n + "-form").hidden = n !== name; });
    $("recovery-form").hidden = true;
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === name));
  }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => showTab(t.dataset.tab)));
  document.querySelectorAll("[data-open]").forEach((a) =>
    a.addEventListener("click", () => showTab(a.dataset.open)));

  function showGuest() {
    state.user = null;
    state.profile = null;
    document.body.classList.remove("in-app");
    $("app").hidden = true;
    $("acceso").hidden = false;
  }

  if (!db) {
    showGuest();
    const m = "Falta configurar config.js con la URL y la clave de Supabase.";
    say("signup-msg", m, true);
    say("login-msg", m, true);
    return;
  }

  /* ---------- Pantallas de la app ---------- */
  function showView(name) {
    if (!state.profile) name = "profile";
    ["feed", "discover", "profile"].forEach((v) => { $("view-" + v).hidden = v !== name; });
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === name));
    if (name === "feed") { loadPeople(); loadFeed(); }
    if (name === "discover") loadPeople();
    window.scrollTo({ top: 0 });
  }

  document.querySelectorAll(".nav-btn[data-view]").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view)));

  $("nav-compose").addEventListener("click", () => {
    showView("feed");
    if (state.profile) $("post-text").focus();
  });

  function renderProfile(user) {
    const p = state.profile;
    $("me-avatar").textContent = initial(p ? p.display_name : user.user_metadata?.display_name);
    if (p) {
      $("account-title").textContent = "Hola, " + p.display_name;
      $("account-sub").textContent = "@" + p.username + " · Tu cuenta está activa.";
      $("profile-name").value = p.display_name;
      $("profile-username").value = p.username;
      $("profile-bio").value = p.bio || "";
    } else {
      $("account-title").textContent = "Crea tu perfil";
      $("account-sub").textContent = "Elige tu nombre de usuario para empezar.";
      $("profile-name").value = user.user_metadata?.display_name || "";
    }
  }

  async function enterApp(user) {
    state.user = user;
    document.body.classList.add("in-app");
    $("acceso").hidden = true;
    $("app").hidden = false;

    const { data, error } = await db
      .from("profiles")
      .select("username, display_name, bio")
      .eq("id", user.id)
      .maybeSingle();
    if (error) say("profile-msg", "No se pudo cargar tu perfil: " + error.message, true);

    state.profile = data || null;
    renderProfile(user);
    showView(state.profile ? "feed" : "profile");
  }

  /* ---------- Personas ---------- */
  async function loadPeople() {
    const { data, error } = await db
      .from("profiles")
      .select("username, display_name, bio")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) { console.error(error); return; }

    const row = $("people-row");
    row.replaceChildren();
    data.slice(0, 12).forEach((p) => {
      const wrap = document.createElement("div");
      wrap.className = "person";
      const ring = document.createElement("span");
      ring.className = "ring";
      ring.textContent = initial(p.display_name);
      const name = document.createElement("small");
      name.textContent = p.display_name.split(" ")[0];
      wrap.append(ring, name);
      row.append(wrap);
    });

    const list = $("people-list");
    list.replaceChildren();
    data.forEach((p) => {
      const card = document.createElement("article");
      card.className = "person-card";
      const av = document.createElement("div");
      av.className = "avatar-sm";
      av.textContent = initial(p.display_name);
      const info = document.createElement("div");
      const n = document.createElement("b");
      n.textContent = p.display_name;
      const u = document.createElement("span");
      u.style.color = "var(--muted)";
      u.textContent = " @" + p.username;
      const bio = document.createElement("p");
      bio.textContent = p.bio || "";
      info.append(n, u, bio);
      card.append(av, info);
      list.append(card);
    });
  }

  /* ---------- Feed ---------- */
  async function loadFeed() {
    const { data: posts, error } = await db
      .from("posts")
      .select("id, content, created_at, user_id, profiles(username, display_name)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      say("post-msg", "No se pudo cargar el feed: " + error.message, true);
      return;
    }

    const likes = {};
    const ids = posts.map((p) => p.id);
    if (ids.length) {
      const { data: rows } = await db.from("post_likes").select("post_id, user_id").in("post_id", ids);
      (rows || []).forEach((r) => {
        (likes[r.post_id] ||= []).push(r.user_id);
      });
    }

    const list = $("feed-list");
    list.replaceChildren();
    $("feed-empty").hidden = posts.length > 0;
    posts.forEach((p) => list.append(renderPost(p, likes[p.id] || [])));
  }

  function renderPost(post, likedBy) {
    const card = document.createElement("article");
    card.className = "post";

    const head = document.createElement("div");
    head.className = "post-head";
    const av = document.createElement("div");
    av.className = "avatar-sm";
    av.textContent = initial(post.profiles?.display_name);
    const who = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = post.profiles?.display_name || "Usuario UNORA";
    const meta = document.createElement("span");
    meta.textContent = "@" + (post.profiles?.username || "usuario") + " · " + when(post.created_at);
    who.append(name, meta);
    head.append(av, who);

    const body = document.createElement("p");
    body.className = "post-body";
    body.textContent = post.content;

    const actions = document.createElement("div");
    actions.className = "post-actions";

    let liked = likedBy.includes(state.user.id);
    let count = likedBy.length;
    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "act";
    const paintLike = () => {
      likeBtn.textContent = (liked ? "♥ " : "♡ ") + count;
      likeBtn.classList.toggle("on", liked);
      likeBtn.setAttribute("aria-pressed", String(liked));
    };
    paintLike();
    likeBtn.addEventListener("click", async () => {
      likeBtn.disabled = true;
      const { error } = liked
        ? await db.from("post_likes").delete().eq("post_id", post.id).eq("user_id", state.user.id)
        : await db.from("post_likes").insert({ post_id: post.id, user_id: state.user.id });
      likeBtn.disabled = false;
      if (error) { console.error(error); return; }
      liked = !liked;
      count += liked ? 1 : -1;
      paintLike();
    });

    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "act";
    shareBtn.textContent = "↗ Compartir";
    shareBtn.addEventListener("click", async () => {
      const url = location.origin + location.pathname;
      try {
        if (navigator.share) {
          await navigator.share({ title: "UNORA", text: post.content.slice(0, 120), url });
        } else {
          await navigator.clipboard.writeText(post.content.slice(0, 120) + " — " + url);
          shareBtn.textContent = "Copiado";
          setTimeout(() => { shareBtn.textContent = "↗ Compartir"; }, 1800);
        }
      } catch { /* el usuario canceló */ }
    });

    actions.append(likeBtn, shareBtn);

    if (post.user_id === state.user.id) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "act danger";
      del.textContent = "Eliminar";
      del.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta publicación?")) return;
        const { error } = await db.from("posts").delete().eq("id", post.id);
        if (error) { say("post-msg", "No se pudo eliminar: " + error.message, true); return; }
        card.remove();
        if (!$("feed-list").children.length) $("feed-empty").hidden = false;
      });
      actions.append(del);
    }

    card.append(head, body, actions);
    return card;
  }

  $("post-text").addEventListener("input", () => {
    $("post-count").textContent = $("post-text").value.length + "/1000";
  });

  $("post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = $("post-text").value.trim();
    if (!content) return;
    const form = e.currentTarget;
    busy(form, true);
    say("post-msg", "");
    const { error } = await db.from("posts").insert({ user_id: state.user.id, content });
    busy(form, false);
    if (error) { say("post-msg", "No se pudo publicar: " + error.message, true); return; }
    $("post-text").value = "";
    $("post-count").textContent = "0/1000";
    await loadFeed();
  });

  /* ---------- Cuenta ---------- */
  $("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, true);
    say("signup-msg", "");
    try {
      const { data, error } = await db.auth.signUp({
        email: $("signup-email").value.trim(),
        password: $("signup-password").value,
        options: {
          data: { display_name: $("signup-name").value.trim() },
          emailRedirectTo: redirectTo
        }
      });
      if (error) throw error;
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        say("signup-msg", "Ese correo ya tiene cuenta. Prueba a iniciar sesión.", true);
      } else if (!data.session) {
        say("signup-msg", "Cuenta creada. Revisa tu correo (y el spam) y pulsa el enlace para confirmarla.");
        form.reset();
      }
    } catch (err) {
      say("signup-msg", friendly(err), true);
    } finally {
      busy(form, false);
    }
  });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, true);
    say("login-msg", "");
    try {
      const { error } = await db.auth.signInWithPassword({
        email: $("login-email").value.trim(),
        password: $("login-password").value
      });
      if (error) throw error;
    } catch (err) {
      say("login-msg", friendly(err), true);
    } finally {
      busy(form, false);
    }
  });

  $("forgot-btn").addEventListener("click", async () => {
    const email = $("login-email").value.trim();
    if (!email) {
      say("login-msg", "Escribe tu correo arriba y pulsa de nuevo.", true);
      return;
    }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) say("login-msg", friendly(error), true);
    else say("login-msg", "Si ese correo tiene cuenta, te hemos enviado un enlace para cambiar la contraseña.");
  });

  $("recovery-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, true);
    const { error } = await db.auth.updateUser({ password: $("recovery-password").value });
    busy(form, false);
    if (error) say("recovery-msg", friendly(error), true);
    else {
      say("recovery-msg", "Contraseña cambiada.");
      $("recovery-form").hidden = true;
    }
  });

  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const username = $("profile-username").value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      say("profile-msg", "El usuario debe tener 3-24 letras minúsculas, números o _.", true);
      return;
    }
    busy(form, true);
    say("profile-msg", "");
    try {
      const wasNew = !state.profile;
      const profile = {
        username,
        display_name: $("profile-name").value.trim(),
        bio: $("profile-bio").value.trim()
      };
      const { error } = await db.from("profiles").upsert({
        id: state.user.id,
        ...profile,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      state.profile = profile;
      renderProfile(state.user);
      if (wasNew) showView("feed");
      else say("profile-msg", "Perfil guardado.");
    } catch (err) {
      say("profile-msg", friendly(err), true);
    } finally {
      busy(form, false);
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    await db.auth.signOut();
  });

  db.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") {
        showGuest();
        $("signup-form").hidden = true;
        $("login-form").hidden = true;
        $("recovery-form").hidden = false;
      } else if (session) {
        if (!state.user || state.user.id !== session.user.id) enterApp(session.user);
      } else {
        showGuest();
        showTab("login");
      }
    }, 0);
  });
})();
