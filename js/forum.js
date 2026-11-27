/* Forum: Auth e Postgres di Supabase, chiave anonima, niente service_role. */
(function () {
  var cfg = window.FORUM_CONFIG || {};
  var client = null;
  var profilo = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function escapeHtml(testo) {
    return String(testo == null ? "" : testo)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function configurato() {
    var url = String(cfg.url || "");
    var key = String(cfg.anonKey || "");
    if (!url || !key) return false;
    if (url.indexOf("INSERISCI") !== -1 || key.indexOf("INSERISCI") !== -1) return false;
    return url.indexOf("https://") === 0;
  }

  function hash() {
    var parti = {};
    String(window.location.hash || "").replace(/^#/, "").split("&").forEach(function (pezzo) {
      if (!pezzo) return;
      var coppia = pezzo.split("=");
      parti[decodeURIComponent(coppia[0])] = decodeURIComponent(coppia[1] || "");
    });
    return parti;
  }

  function vai(parametri) {
    var pezzi = [];
    Object.keys(parametri).forEach(function (chiave) {
      if (parametri[chiave]) pezzi.push(encodeURIComponent(chiave) + "=" + encodeURIComponent(parametri[chiave]));
    });
    window.location.hash = pezzi.join("&");
  }

  function monta(html) {
    var mount = $("#contenuto");
    if (mount) mount.innerHTML = html;
  }

  function inArrivo() {
    document.title = "Forum – GT Lepini Ausoni";
    monta(
      '<p class="page-kicker">Gruppo Territoriale Lepini Ausoni</p>' +
      "<h1>Forum in arrivo</h1>" +
      '<p class="lead">L\'area riservata non è ancora collegata. Quando il progetto Supabase sarà configurato, qui si potrà entrare con email e password.</p>'
    );
  }

  function errore(messaggio) {
    return '<p class="forum-errore">' + escapeHtml(messaggio || "Operazione non riuscita") + "</p>";
  }

  function dataBreve(iso) {
    if (!iso) return "";
    return String(iso).replace("T", " ").slice(0, 16);
  }

  function eAdmin() {
    return profilo && profilo.role === "admin" && !profilo.blocked;
  }

  function eModeratore() {
    return profilo && (profilo.role === "staff" || profilo.role === "admin") && !profilo.blocked;
  }

  function etichettaRuolo(ruolo) {
    if (ruolo === "admin") return "Admin";
    if (ruolo === "staff") return "Staff";
    if (ruolo === "iscritto") return "Iscritto";
    return "Registrato";
  }

  async function nomeDi(id) {
    var esito = await client.rpc("forum_nome", { utente: id });
    var etichetta = await client.rpc("forum_etichetta", { utente: id });
    var nome = esito.data || "Utente";
    if (etichetta.data) nome += " · " + etichetta.data;
    return nome;
  }

  async function autoreAdmin(id) {
    var etichetta = await client.rpc("forum_etichetta", { utente: id });
    return etichetta.data === "Admin";
  }

  async function caricaProfilo() {
    var session = await client.auth.getSession();
    var utente = session.data.session && session.data.session.user;
    if (!utente) {
      profilo = null;
      return null;
    }
    var esito = await client.from("profiles").select("id, email, display_name, role, blocked").eq("id", utente.id).maybeSingle();
    profilo = esito.data || null;
    return profilo;
  }

  function barra() {
    if (!profilo) return "";
    var html = '<div class="forum-azioni">';
    html += '<button type="button" class="secondario" id="forum-home">Sezioni</button>';
    if (profilo.role === "registrato" && !profilo.blocked) {
      html += '<button type="button" id="forum-richiedi">Richiedi accesso iscritti</button>';
    }
    if (eModeratore()) {
      html += '<button type="button" id="forum-staff">Pannello staff</button>';
    }
    html += '<button type="button" class="secondario" id="forum-esci">Esci</button>';
    html += "</div>";
    html += '<p class="forum-meta">Sei entrato come ' + escapeHtml(profilo.display_name) + " · " + escapeHtml(etichettaRuolo(profilo.role)) + "</p>";
    return html;
  }

  function collegaBarra() {
    var home = $("#forum-home");
    if (home) home.addEventListener("click", function () { vai({}); });
    var staff = $("#forum-staff");
    if (staff) staff.addEventListener("click", function () { vai({ pagina: "staff" }); });
    var esci = $("#forum-esci");
    if (esci) esci.addEventListener("click", function () {
      client.auth.signOut().then(function () { vai({}); });
    });
    var chiedi = $("#forum-richiedi");
    if (chiedi) chiedi.addEventListener("click", function () { vai({ pagina: "richiesta" }); });
  }

  function schermataAccesso(avviso) {
    document.title = "Forum – Accedi";
    monta(
      '<p class="page-kicker">Gruppo Territoriale Lepini Ausoni</p>' +
      "<h1>Forum</h1>" +
      (avviso ? errore(avviso) : "") +
      '<div class="forum-box forum-form"><h2>Accedi</h2>' +
      '<form id="forum-login"><label for="login-email">Email</label><input id="login-email" type="email" required autocomplete="username">' +
      '<label for="login-password">Password</label><input id="login-password" type="password" required autocomplete="current-password" minlength="8">' +
      '<div class="forum-azioni"><button type="submit">Entra</button></div><p id="login-msg" class="forum-errore" hidden></p></form></div>' +
      '<div class="forum-box forum-form"><h2>Crea un account</h2>' +
      '<form id="forum-registra"><label for="reg-nome">Nome visibile</label><input id="reg-nome" required maxlength="80">' +
      '<label for="reg-email">Email</label><input id="reg-email" type="email" required autocomplete="email">' +
      '<label for="reg-password">Password (almeno 8 caratteri)</label><input id="reg-password" type="password" required minlength="8" autocomplete="new-password">' +
      '<div class="forum-azioni"><button type="submit">Registrati</button></div><p id="reg-msg" class="forum-errore" hidden></p></form></div>'
    );
    $("#forum-login").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = $("#login-msg");
      client.auth.signInWithPassword({
        email: $("#login-email").value.trim(),
        password: $("#login-password").value
      }).then(function (esito) {
        if (esito.error) {
          msg.hidden = false;
          msg.textContent = "Accesso non riuscito. Controlla email e password, oppure conferma l'indirizzo dalla posta.";
          return;
        }
        vai({});
      });
    });
    $("#forum-registra").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = $("#reg-msg");
      client.auth.signUp({
        email: $("#reg-email").value.trim(),
        password: $("#reg-password").value,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
          data: { display_name: $("#reg-nome").value.trim() }
        }
      }).then(function (esito) {
        msg.hidden = false;
        if (esito.error) {
          msg.textContent = "Registrazione non riuscita. Se l'email è già usata, prova ad accedere.";
          return;
        }
        msg.textContent = "Controlla la posta e conferma l'indirizzo, poi accedi.";
      });
    });
  }

  async function elencoSezioni() {
    document.title = "Forum – GT Lepini Ausoni";
    var esito = await client.from("sections").select("id, slug, nome, descrizione, visibilita, ordine").order("ordine");
    var html = '<p class="page-kicker">Gruppo Territoriale Lepini Ausoni</p><h1>Forum</h1>' + barra();
    if (profilo && profilo.blocked) {
      html += '<p class="forum-errore">Il tuo account è bloccato. Non puoi leggere né scrivere nel forum.</p>';
      monta(html);
      collegaBarra();
      return;
    }
    if (esito.error) {
      monta(html + errore("Non riesco a leggere le sezioni."));
      collegaBarra();
      return;
    }
    (esito.data || []).forEach(function (sezione) {
      html += '<article class="forum-card"><h2><a href="#sezione=' + encodeURIComponent(sezione.slug) + '">' + escapeHtml(sezione.nome) + "</a></h2>";
      html += "<p>" + escapeHtml(sezione.descrizione) + "</p></article>";
    });
    monta(html);
    collegaBarra();
  }

  async function elencoDiscussioni(slug) {
    var sezioni = await client.from("sections").select("id, slug, nome, descrizione").eq("slug", slug).maybeSingle();
    if (!sezioni.data) {
      monta(barra() + errore("Sezione non disponibile."));
      collegaBarra();
      return;
    }
    var sezione = sezioni.data;
    document.title = sezione.nome + " – Forum";
    var discussioni = await client.from("threads").select("id, titolo, author_id, created_at").eq("section_id", sezione.id).order("created_at", { ascending: false });
    var html = '<p class="page-kicker"><a href="#top" id="forum-torna-sezioni">Forum</a></p><h1>' + escapeHtml(sezione.nome) + "</h1>";
    html += "<p>" + escapeHtml(sezione.descrizione) + "</p>" + barra();
    html += '<p class="forum-azioni"><a class="forum-linkbtn" href="#nuova=' + encodeURIComponent(slug) + '">Nuova discussione</a></p>';
    if (discussioni.error) html += errore("Discussioni non disponibili.");
    for (var i = 0; i < (discussioni.data || []).length; i++) {
      var thread = discussioni.data[i];
      var autore = await nomeDi(thread.author_id);
      html += '<article class="forum-card"><h2><a href="#discussione=' + thread.id + '">' + escapeHtml(thread.titolo) + "</a></h2>";
      html += '<p class="forum-meta">' + escapeHtml(autore) + " · " + escapeHtml(dataBreve(thread.created_at)) + "</p></article>";
    }
    if (!(discussioni.data || []).length) html += '<p class="vuoto">Nessuna discussione in questa sezione.</p>';
    monta(html);
    collegaBarra();
    var torna = $("#forum-torna-sezioni");
    if (torna) torna.addEventListener("click", function (ev) { ev.preventDefault(); vai({}); });
  }

  async function mostraDiscussione(id) {
    var thread = await client.from("threads").select("id, section_id, titolo, author_id, created_at").eq("id", id).maybeSingle();
    if (!thread.data) {
      monta(barra() + errore("Discussione non disponibile."));
      collegaBarra();
      return;
    }
    var sezione = await client.from("sections").select("slug, nome").eq("id", thread.data.section_id).maybeSingle();
    var messaggi = await client.from("posts").select("id, author_id, corpo, created_at").eq("thread_id", id).order("created_at");
    var threadDiAdmin = await autoreAdmin(thread.data.author_id);
    var messaggioDiAdmin = threadDiAdmin;
    var blocchi = [];
    for (var i = 0; i < (messaggi.data || []).length; i++) {
      var post = messaggi.data[i];
      var diAdmin = await autoreAdmin(post.author_id);
      if (diAdmin) messaggioDiAdmin = true;
      blocchi.push({ post: post, diAdmin: diAdmin, autore: await nomeDi(post.author_id) });
    }
    document.title = thread.data.titolo + " – Forum";
    var html = '<p class="page-kicker"><a href="#sezione=' + encodeURIComponent(sezione.data ? sezione.data.slug : "") + '">' + escapeHtml(sezione.data ? sezione.data.nome : "Forum") + "</a></p>";
    html += "<h1>" + escapeHtml(thread.data.titolo) + "</h1>" + barra();
    if (eAdmin() || (eModeratore() && !messaggioDiAdmin)) {
      html += '<div class="forum-azioni"><button type="button" class="secondario" id="forum-cancella-thread">Cancella discussione</button></div>';
    }
    blocchi.forEach(function (blocco) {
      html += '<article class="forum-messaggio"><p class="forum-meta">' + escapeHtml(blocco.autore) + " · " + escapeHtml(dataBreve(blocco.post.created_at)) + "</p>";
      html += "<p>" + escapeHtml(blocco.post.corpo) + "</p>";
      if (eAdmin() || (eModeratore() && !blocco.diAdmin)) {
        html += '<button type="button" class="secondario" data-cancella-post="' + blocco.post.id + '">Cancella messaggio</button>';
      }
      html += "</article>";
    });
    if (!profilo.blocked) {
      html += '<form id="forum-risposta" class="forum-form"><label for="risposta-corpo">Rispondi</label><textarea id="risposta-corpo" required maxlength="8000"></textarea>';
      html += '<div class="forum-azioni"><button type="submit">Pubblica risposta</button></div><p id="risposta-msg" class="forum-errore" hidden></p></form>';
    }
    monta(html);
    collegaBarra();
    var cancella = $("#forum-cancella-thread");
    if (cancella) cancella.addEventListener("click", function () {
      if (!window.confirm("Cancellare questa discussione e tutte le risposte?")) return;
      client.from("threads").delete().eq("id", id).then(function (esito) {
        if (esito.error) return;
        vai({ sezione: sezione.data ? sezione.data.slug : "" });
      });
    });
    document.querySelectorAll("[data-cancella-post]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var postId = btn.getAttribute("data-cancella-post");
        client.from("posts").delete().eq("id", postId).then(function () { vai({ discussione: id }); });
      });
    });
    var form = $("#forum-risposta");
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      client.from("posts").insert({ thread_id: id, author_id: profilo.id, corpo: $("#risposta-corpo").value.trim() }).then(function (esito) {
        var msg = $("#risposta-msg");
        if (esito.error) {
          msg.hidden = false;
          msg.textContent = "Risposta non pubblicata.";
          return;
        }
        vai({ discussione: id });
      });
    });
  }

  async function nuovaDiscussione(slug) {
    var sezioni = await client.from("sections").select("id, slug, nome").eq("slug", slug).maybeSingle();
    if (!sezioni.data) {
      monta(barra() + errore("Non puoi aprire una discussione in questa sezione."));
      collegaBarra();
      return;
    }
    document.title = "Nuova discussione – Forum";
    monta(
      '<p class="page-kicker">' + escapeHtml(sezioni.data.nome) + "</p><h1>Nuova discussione</h1>" + barra() +
      '<form id="forum-nuova" class="forum-form"><label for="nuova-titolo">Titolo</label><input id="nuova-titolo" required minlength="3" maxlength="180">' +
      '<label for="nuova-corpo">Messaggio</label><textarea id="nuova-corpo" required maxlength="8000"></textarea>' +
      '<div class="forum-azioni"><button type="submit">Apri discussione</button></div><p id="nuova-msg" class="forum-errore" hidden></p></form>'
    );
    collegaBarra();
    $("#forum-nuova").addEventListener("submit", function (ev) {
      ev.preventDefault();
      client.from("threads").insert({
        section_id: sezioni.data.id,
        author_id: profilo.id,
        titolo: $("#nuova-titolo").value.trim()
      }).select("id").single().then(function (esito) {
        var msg = $("#nuova-msg");
        if (esito.error || !esito.data) {
          msg.hidden = false;
          msg.textContent = "Discussione non creata. Forse non hai accesso a questa sezione.";
          return;
        }
        client.from("posts").insert({
          thread_id: esito.data.id,
          author_id: profilo.id,
          corpo: $("#nuova-corpo").value.trim()
        }).then(function (post) {
          if (post.error) {
            msg.hidden = false;
            msg.textContent = "La discussione è aperta ma il primo messaggio non è stato salvato.";
            return;
          }
          vai({ discussione: esito.data.id });
        });
      });
    });
  }

  function paginaRichiesta() {
    document.title = "Richiedi accesso iscritti – Forum";
    monta(
      "<h1>Richiedi accesso iscritti</h1>" + barra() +
      '<p>La richiesta arriva allo staff del Gruppo Territoriale. Dopo l\'approvazione potrai leggere e scrivere nell\'Area iscritti M5S.</p>' +
      '<form id="forum-richiesta" class="forum-form"><label for="richiesta-testo">Messaggio per lo staff (facoltativo)</label>' +
      '<textarea id="richiesta-testo" maxlength="2000"></textarea>' +
      '<div class="forum-azioni"><button type="submit">Invia richiesta</button></div><p id="richiesta-msg" class="forum-errore" hidden></p></form>'
    );
    collegaBarra();
    $("#forum-richiesta").addEventListener("submit", function (ev) {
      ev.preventDefault();
      client.from("access_requests").insert({ user_id: profilo.id, messaggio: $("#richiesta-testo").value.trim(), stato: "in_attesa" }).then(function (esito) {
        var msg = $("#richiesta-msg");
        msg.hidden = false;
        msg.textContent = esito.error ? "Richiesta non inviata. Forse ne hai già una in attesa." : "Richiesta inviata allo staff.";
      });
    });
  }

  function opzioneRuolo(valore, etichetta, attuale) {
    return '<option value="' + valore + '"' + (attuale === valore ? " selected" : "") + ">" + etichetta + "</option>";
  }

  function schedaUtente(utente) {
    var html = '<article class="forum-card"><h3>' + escapeHtml(utente.display_name);
    if (utente.role === "admin") html += " · Admin";
    html += "</h3>";
    html += '<p class="forum-meta">' + escapeHtml(utente.email) + " · " + escapeHtml(etichettaRuolo(utente.role)) + "</p>";
    if (utente.role === "admin") return html + "</article>";
    if (!eAdmin() && utente.role === "staff") return html + "</article>";
    html += '<form class="forum-form" data-utente="' + utente.id + '">';
    html += "<label>Ruolo<select data-ruolo>";
    html += opzioneRuolo("registrato", "Registrato", utente.role);
    html += opzioneRuolo("iscritto", "Iscritto", utente.role);
    if (eAdmin()) html += opzioneRuolo("staff", "Staff", utente.role);
    html += "</select></label>";
    html += '<label><input type="checkbox" data-blocco' + (utente.blocked ? " checked" : "") + "> Account bloccato</label>";
    html += '<div class="forum-azioni"><button type="submit">Salva</button></div></form></article>';
    return html;
  }

  async function pannelloStaff() {
    if (!eModeratore()) {
      monta(barra() + errore("Pannello riservato allo staff del gruppo."));
      collegaBarra();
      return;
    }
    document.title = "Pannello staff – Forum";
    var richieste = await client.from("access_requests").select("id, user_id, messaggio, stato, created_at").eq("stato", "in_attesa").order("created_at");
    var utenti = await client.from("profiles").select("id, email, display_name, role, blocked").order("created_at");
    var html = "<h1>Pannello staff</h1>" + barra() + "<h2>Richieste di accesso iscritti</h2>";
    if (!(richieste.data || []).length) html += '<p class="vuoto">Nessuna richiesta in attesa.</p>';
    for (var i = 0; i < (richieste.data || []).length; i++) {
      var richiesta = richieste.data[i];
      var nome = await nomeDi(richiesta.user_id);
      html += '<article class="forum-card"><h3>' + escapeHtml(nome) + "</h3>";
      html += "<p>" + escapeHtml(richiesta.messaggio || "Nessun messaggio.") + "</p>";
      html += '<div class="forum-azioni"><button type="button" data-approva="' + richiesta.id + '">Approva come iscritto</button>';
      html += '<button type="button" class="secondario" data-rifiuta="' + richiesta.id + '">Rifiuta</button></div></article>';
    }
    html += "<h2>Utenti</h2>";
    if (eAdmin()) html += '<p class="forum-meta">Solo l\'admin può nominare o togliere lo staff. Nessuno può nominare un altro admin da qui.</p>';
    (utenti.data || []).forEach(function (utente) {
      html += schedaUtente(utente);
    });
    monta(html);
    collegaBarra();
    document.querySelectorAll("[data-approva]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        client.rpc("forum_decidi_richiesta", { richiesta: btn.getAttribute("data-approva"), approva: true }).then(function () {
          vai({ pagina: "staff" });
        });
      });
    });
    document.querySelectorAll("[data-rifiuta]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        client.rpc("forum_decidi_richiesta", { richiesta: btn.getAttribute("data-rifiuta"), approva: false }).then(function () {
          vai({ pagina: "staff" });
        });
      });
    });
    document.querySelectorAll("form[data-utente]").forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        client.from("profiles").update({
          role: form.querySelector("[data-ruolo]").value,
          blocked: form.querySelector("[data-blocco]").checked
        }).eq("id", form.getAttribute("data-utente")).then(function () { vai({ pagina: "staff" }); });
      });
    });
  }

  async function disegna() {
    if (!configurato()) {
      inArrivo();
      return;
    }
    if (!client) {
      monta(errore("Libreria del forum non caricata."));
      return;
    }
    await caricaProfilo();
    if (!profilo) {
      schermataAccesso("");
      return;
    }
    if (profilo.blocked) {
      document.title = "Forum – Account bloccato";
      monta('<h1>Forum</h1>' + barra() + '<p class="forum-errore">Il tuo account è bloccato. Non puoi leggere né scrivere nel forum.</p>');
      collegaBarra();
      return;
    }
    var stato = hash();
    if (stato.pagina === "staff") return pannelloStaff();
    if (stato.pagina === "richiesta") return paginaRichiesta();
    if (stato.discussione) return mostraDiscussione(stato.discussione);
    if (stato.nuova) return nuovaDiscussione(stato.nuova);
    if (stato.sezione) return elencoDiscussioni(stato.sezione);
    return elencoSezioni();
  }

  function avvia() {
    if (!configurato()) {
      inArrivo();
      return;
    }
    var script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2";
    script.onload = function () {
      client = window.supabase.createClient(cfg.url, cfg.anonKey);
      window.addEventListener("hashchange", disegna);
      disegna();
    };
    script.onerror = function () {
      monta(errore("Non riesco a caricare la libreria del forum."));
    };
    document.head.appendChild(script);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
  else avvia();
})();
