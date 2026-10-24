(() => {
  "use strict";

  const cfg = window.UNORA_CONFIG || {};
  const ready = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase;
  const db = ready ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const $ = (id) => document.getElementById(id);
  const redirectTo = location.origin + location.pathname;

  function say(id, text, isError = false) {
    const el = $(id);
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

  function showTab(name) {
    ["signup", "login"].forEach((n) => {
      $(n + "-form").hidden = n !== name;
    });
    $("recovery-form").hidden = true;
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === name));
  }

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => showTab(t.dataset.tab)));
  document.querySelectorAll("[data-open]").forEach((a) =>
    a.addEventListener("click", () => showTab(a.dataset.open)));

  function showGuest() {
    $("acceso").hidden = false;
    $("cuenta").hidden = true;
  }

  async function showAccount(user) {
    $("acceso").hidden = true;
    $("cuenta").hidden = false;

    const { data: profile, error } = await db
      .from("profiles")
      .select("username, display_name, bio")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      say("profile-msg", "No se pudo cargar tu perfil: " + error.message, true);
      return;
    }

    if (profile) {
      $("account-title").textContent = "Hola, " + profile.display_name;
      $("account-sub").textContent = "@" + profile.username + " · Tu cuenta está activa.";
      $("profile-name").value = profile.display_name;
      $("profile-username").value = profile.username;
      $("profile-bio").value = profile.bio || "";
    } else {
      $("account-title").textContent = "Crea tu perfil";
      $("account-sub").textContent = "Elige tu nombre de usuario para empezar.";
      $("profile-name").value = user.user_metadata?.display_name || "";
    }
    $("cuenta").scrollIntoView({ behavior: "smooth" });
  }

  if (!db) {
    showGuest();
    const m = "Falta configurar config.js con la URL y la clave de Supabase.";
    say("signup-msg", m, true);
    say("login-msg", m, true);
    return;
  }

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
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Sesión caducada");
      const { error } = await db.from("profiles").upsert({
        id: user.id,
        username,
        display_name: $("profile-name").value.trim(),
        bio: $("profile-bio").value.trim(),
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      say("profile-msg", "Perfil guardado.");
      await showAccount(user);
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
        showAccount(session.user);
      } else {
        showGuest();
        showTab("login");
      }
    }, 0);
  });
})();
