/* Forum: Auth e Postgres di Supabase, chiave anonima, niente service_role. */
(function () {
  var cfg = window.FORUM_CONFIG || {};
  var client = null;
  var profilo = null;
  var schede = {};
  var iscrittiNewsletter = [];

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

  function href(parametri) {
    var pezzi = [];
    Object.keys(parametri).forEach(function (chiave) {
      if (parametri[chiave]) pezzi.push(encodeURIComponent(chiave) + "=" + encodeURIComponent(parametri[chiave]));
    });
    return "#" + pezzi.join("&");
  }

  function vai(parametri) {
    var nuovo = href(parametri).slice(1);
    if ((window.location.hash || "").replace(/^#/, "") === nuovo) {
      disegna();
      return;
    }
    window.location.hash = nuovo;
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
    return '<p class="forum-errore" role="alert">' + escapeHtml(messaggio || "Operazione non riuscita") + "</p>";
  }

  function dataBreve(iso) {
    if (!iso) return "";
    var data = new Date(iso);
    if (isNaN(data.getTime())) return "";
    return data.toLocaleString("it-IT", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function conta(n, uno, tanti) {
    return String(n) + " " + (n === 1 ? uno : tanti);
  }

  function mancaSchema(esito) {
    if (!esito || !esito.error) return false;
    var msg = String(esito.error.message || "") + " " + String(esito.error.details || "");
    return esito.error.code === "PGRST205" || esito.error.code === "42P01" || msg.indexOf("categories") !== -1 || msg.indexOf("category_id") !== -1;
  }

  function avvisoSchema() {
    return errore("Il forum non è aggiornato. Nel SQL Editor di Supabase esegui il file supabase/forum_macroaree.sql.");
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

  function badge(ruolo) {
    var testo = ruolo || "Registrato";
    var chiave = "registrato";
    if (testo === "Admin") chiave = "admin";
    else if (testo === "Staff") chiave = "staff";
    else if (testo === "Iscritto") chiave = "iscritto";
    return '<span class="forum-badge forum-badge-' + chiave + '">' + escapeHtml(testo) + "</span>";
  }

  function icona() {
    return '<span class="forum-icona" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg></span>';
  }

  function briciole(pezzi) {
    if (!pezzi || !pezzi.length) return "";
    var html = '<nav class="forum-briciole" aria-label="Percorso">';
    pezzi.forEach(function (pezzo, indice) {
      if (indice) html += '<span class="forum-sep" aria-hidden="true">›</span>';
      var ultimo = indice === pezzi.length - 1;
      if (!ultimo && pezzo.href) html += '<a href="' + pezzo.href + '">' + escapeHtml(pezzo.testo) + "</a>";
      else html += '<span' + (ultimo ? ' aria-current="page"' : "") + ">" + escapeHtml(pezzo.testo) + "</span>";
    });
    return html + "</nav>";
  }

  function slugifica(testo) {
    var base = String(testo || "").toLowerCase();
    if (base.normalize) base = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    base = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    return base || "area";
  }

  function slugLibero(base, esistenti) {
    var usati = {};
    esistenti.forEach(function (categoria) { usati[categoria.slug] = true; });
    var slug = base;
    var n = 2;
    while (usati[slug]) {
      slug = base.slice(0, 36) + "-" + n;
      n += 1;
    }
    return slug;
  }

  async function schedaAutore(id) {
    if (!id) return { nome: "Utente", ruolo: "" };
    if (schede[id]) return schede[id];
    try {
      var nome = await client.rpc("forum_nome", { utente: id });
      var etichetta = await client.rpc("forum_etichetta", { utente: id });
      schede[id] = {
        nome: nome.error ? "Utente" : (nome.data || "Utente"),
        ruolo: etichetta.error ? "" : (etichetta.data || "")
      };
    } catch (e) {
      schede[id] = { nome: "Utente", ruolo: "" };
    }
    return schede[id];
  }

  async function autoreAdmin(id) {
    var scheda = await schedaAutore(id);
    return scheda.ruolo === "Admin";
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
    var sulPannello = hash().pagina === "staff";
    var html = '<div class="forum-barra">';
    html += '<p class="forum-chi"><span class="forum-chi-nome">' + escapeHtml(profilo.display_name) + "</span>";
    html += badge(etichettaRuolo(profilo.role)) + "</p>";
    html += '<div class="forum-barra-azioni">';
    if (profilo.role === "registrato" && !profilo.blocked) {
      html += '<a class="forum-link-testo" href="#pagina=richiesta">Richiedi accesso iscritti</a>';
    }
    if (eModeratore()) {
      html += '<a class="forum-pannello-link" href="#pagina=staff&scheda=richieste"' + (sulPannello ? ' aria-current="page"' : "") + ">";
      html += (eAdmin() ? "Pannello admin" : "Pannello staff") + "</a>";
    }
    html += '<button type="button" class="secondario" id="forum-esci">Esci</button>';
    html += "</div></div>";
    return html;
  }

  function collegaBarra() {
    var esci = $("#forum-esci");
    if (esci) esci.addEventListener("click", function () {
      client.auth.signOut().then(function () { vai({}); });
    });
  }

  function pagina(opzioni) {
    document.title = opzioni.titolo + " – Forum";
    monta(
      barra() +
      opzioni.briciole +
      "<h1>" + escapeHtml(opzioni.titolo) + "</h1>" +
      (opzioni.intro ? '<p class="forum-intro">' + escapeHtml(opzioni.intro) + "</p>" : "") +
      (opzioni.corpo || "")
    );
    collegaBarra();
  }

  function schermataAccesso(avviso) {
    document.title = "Forum – Accedi";
    monta(
      '<p class="page-kicker">Gruppo Territoriale Lepini Ausoni</p>' +
      "<h1>Forum</h1>" +
      '<p class="forum-intro">Entra con la tua email per leggere e scrivere nelle sezioni che ti sono aperte.</p>' +
      (avviso ? errore(avviso) : "") +
      '<div class="forum-accessi"><div class="forum-box forum-form"><h2>Accedi</h2>' +
      '<form id="forum-login"><label for="login-email">Email</label><input id="login-email" type="email" required autocomplete="username">' +
      '<label for="login-password">Password</label><input id="login-password" type="password" required autocomplete="current-password" minlength="8">' +
      '<div class="forum-azioni"><button type="submit">Entra</button></div><p id="login-msg" class="forum-errore" role="alert" hidden></p></form></div>' +
      '<div class="forum-box forum-form"><h2>Crea un account</h2>' +
      '<form id="forum-registra"><label for="reg-nome">Nome visibile</label><input id="reg-nome" required maxlength="80">' +
      '<label for="reg-email">Email</label><input id="reg-email" type="email" required autocomplete="email">' +
      '<label for="reg-password">Password (almeno 8 caratteri)</label><input id="reg-password" type="password" required minlength="8" autocomplete="new-password">' +
      '<div class="forum-azioni"><button type="submit">Registrati</button></div><p id="reg-msg" class="forum-errore" role="alert" hidden></p></form></div></div>'
    );
    $("#forum-login").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = $("#login-msg");
      msg.hidden = false;
      msg.textContent = "Accesso in corso…";
      client.auth.signInWithPassword({
        email: $("#login-email").value.trim(),
        password: $("#login-password").value
      }).then(function (esito) {
        if (esito.error) {
          msg.hidden = false;
          msg.textContent = "Accesso non riuscito. Controlla email e password, oppure conferma l'indirizzo dalla posta.";
          return;
        }
        disegna();
      }).catch(function () {
        msg.hidden = false;
        msg.textContent = "Accesso non riuscito. Controlla la connessione e riprova.";
      });
    });
    $("#forum-registra").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = $("#reg-msg");
      msg.hidden = false;
      msg.textContent = "Registrazione in corso…";
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
      }).catch(function () {
        msg.hidden = false;
        msg.textContent = "Registrazione non riuscita. Controlla la connessione e riprova.";
      });
    });
  }

  function riepilogo(threads, posts) {
    var perThread = {};
    (threads || []).forEach(function (thread) {
      perThread[thread.id] = {
        category_id: thread.category_id,
        author_id: thread.author_id,
        risposte: 0,
        ultimoAutore: thread.author_id,
        ultimoData: thread.created_at,
        messaggi: 0
      };
    });
    (posts || []).forEach(function (post) {
      var info = perThread[post.thread_id];
      if (!info) return;
      info.messaggi += 1;
      if (!info.ultimoData || String(post.created_at) >= String(info.ultimoData)) {
        info.ultimoData = post.created_at;
        info.ultimoAutore = post.author_id;
      }
    });
    Object.keys(perThread).forEach(function (id) {
      var info = perThread[id];
      info.risposte = info.messaggi > 0 ? info.messaggi - 1 : 0;
    });
    return perThread;
  }

  async function nomiUltimi(ids) {
    var unici = [];
    ids.forEach(function (id) {
      if (id && unici.indexOf(id) === -1) unici.push(id);
    });
    await Promise.all(unici.map(schedaAutore));
  }

  function rigaMacroarea(sezione, categoria, stat) {
    var hrefRiga = href({ sezione: sezione.slug, macroarea: categoria.slug });
    var html = '<a class="forum-riga" href="' + hrefRiga + '">' + icona();
    html += '<span class="forum-riga-testo"><strong>' + escapeHtml(categoria.nome) + "</strong>";
    html += "<span>" + escapeHtml(categoria.descrizione || "Nessuna descrizione.") + "</span></span>";
    html += '<span class="forum-numeri"><span><strong>' + stat.discussioni + "</strong> " + (stat.discussioni === 1 ? "discussione" : "discussioni") + "</span>";
    html += "<span><strong>" + stat.risposte + "</strong> " + (stat.risposte === 1 ? "risposta" : "risposte") + "</span></span>";
    if (stat.ultimoData) {
      var autore = schede[stat.ultimoAutore] || { nome: "Utente" };
      html += '<span class="forum-ultimo"><span class="forum-ultimo-chi">' + escapeHtml(autore.nome) + '</span><span class="forum-ultimo-quando">' + escapeHtml(dataBreve(stat.ultimoData)) + "</span></span>";
    } else {
      html += '<span class="forum-ultimo">Nessun messaggio</span>';
    }
    return html + "</a>";
  }

  async function vistaSezioni(soloSlug) {
    var sezioni = await client.from("sections").select("id, slug, nome, descrizione, visibilita, ordine").order("ordine");
    var macro = await client.from("categories").select("id, section_id, slug, nome, descrizione, ordine").order("ordine");
    if (mancaSchema(macro)) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum" }]), corpo: avvisoSchema() });
      return;
    }
    if (sezioni.error || macro.error) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum" }]), corpo: errore("Non riesco a leggere le sezioni.") });
      return;
    }
    var lista = sezioni.data || [];
    if (soloSlug) lista = lista.filter(function (sezione) { return sezione.slug === soloSlug; });
    if (soloSlug && !lista.length) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: errore("Sezione non disponibile.") });
      return;
    }
    var ids = lista.map(function (sezione) { return sezione.id; });
    var threads = ids.length
      ? await client.from("threads").select("id, category_id, author_id, created_at, section_id").in("section_id", ids)
      : { data: [] };
    var posts = { data: [] };
    if ((threads.data || []).length) {
      posts = await client.from("posts").select("id, thread_id, author_id, created_at").in("thread_id", threads.data.map(function (t) { return t.id; }));
    }
    if (mancaSchema(threads)) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum" }]), corpo: avvisoSchema() });
      return;
    }
    if (threads.error || posts.error) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum" }]), corpo: errore("Non riesco a leggere le discussioni.") });
      return;
    }
    var perThread = riepilogo(threads.data, posts.data);
    var perCategoria = {};
    (macro.data || []).forEach(function (categoria) {
      perCategoria[categoria.id] = { discussioni: 0, risposte: 0, ultimoData: "", ultimoAutore: "" };
    });
    Object.keys(perThread).forEach(function (id) {
      var info = perThread[id];
      var stat = perCategoria[info.category_id];
      if (!stat) return;
      stat.discussioni += 1;
      stat.risposte += info.risposte;
      if (!stat.ultimoData || String(info.ultimoData) >= String(stat.ultimoData)) {
        stat.ultimoData = info.ultimoData;
        stat.ultimoAutore = info.ultimoAutore;
      }
    });
    await nomiUltimi((macro.data || []).map(function (categoria) {
      return (perCategoria[categoria.id] || {}).ultimoAutore;
    }));
    var titolo = soloSlug ? lista[0].nome : "Forum";
    var percorso = soloSlug
      ? [{ testo: "Forum", href: href({}) }, { testo: lista[0].nome }]
      : [];
    var corpo = "";
    lista.forEach(function (sezione) {
      var categorie = (macro.data || []).filter(function (categoria) { return categoria.section_id === sezione.id; });
      categorie.sort(function (a, b) { return a.ordine - b.ordine || String(a.nome).localeCompare(String(b.nome), "it"); });
      corpo += '<section class="forum-sezione"><header class="forum-sezione-testa"><h2>';
      corpo += soloSlug ? escapeHtml(sezione.nome) : '<a href="' + href({ sezione: sezione.slug }) + '">' + escapeHtml(sezione.nome) + "</a>";
      corpo += "</h2><p>" + escapeHtml(sezione.descrizione) + "</p></header>";
      if (!categorie.length) {
        corpo += '<p class="vuoto">Nessuna macroarea in questa sezione.</p>';
      } else {
        corpo += '<div class="forum-riga-testa" aria-hidden="true"><span></span><span>Macroarea</span><span>Attività</span><span>Ultimo messaggio</span></div>';
        categorie.forEach(function (categoria) {
          corpo += rigaMacroarea(sezione, categoria, perCategoria[categoria.id]);
        });
      }
      corpo += "</section>";
    });
    pagina({
      titolo: titolo,
      intro: soloSlug ? "" : "Scegli una macroarea per leggere le discussioni.",
      briciole: briciole(percorso),
      corpo: corpo
    });
  }

  async function elencoDiscussioni(slug, macroSlug) {
    var sezioni = await client.from("sections").select("id, slug, nome, descrizione").eq("slug", slug).maybeSingle();
    if (!sezioni.data) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: errore("Sezione non disponibile.") });
      return;
    }
    var sezione = sezioni.data;
    var macro = await client.from("categories").select("id, slug, nome, descrizione").eq("section_id", sezione.id).eq("slug", macroSlug).maybeSingle();
    if (mancaSchema(macro)) {
      pagina({ titolo: sezione.nome, briciole: briciole([{ testo: "Forum", href: href({}) }, { testo: sezione.nome }]), corpo: avvisoSchema() });
      return;
    }
    if (!macro.data) {
      pagina({
        titolo: sezione.nome,
        briciole: briciole([{ testo: "Forum", href: href({}) }, { testo: sezione.nome, href: href({ sezione: sezione.slug }) }]),
        corpo: errore("Macroarea non disponibile.")
      });
      return;
    }
    var categoria = macro.data;
    var discussioni = await client.from("threads").select("id, titolo, author_id, created_at").eq("category_id", categoria.id).order("created_at", { ascending: false });
    var posts = { data: [] };
    if ((discussioni.data || []).length) {
      posts = await client.from("posts").select("id, thread_id, author_id, created_at").in("thread_id", discussioni.data.map(function (t) { return t.id; }));
    }
    if (mancaSchema(discussioni)) {
      pagina({ titolo: categoria.nome, briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: avvisoSchema() });
      return;
    }
    if (discussioni.error || posts.error) {
      pagina({ titolo: categoria.nome, briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: errore("Discussioni non disponibili.") });
      return;
    }
    var perThread = riepilogo(discussioni.data, posts.data);
    var righe = (discussioni.data || []).slice().sort(function (a, b) {
      return String(perThread[b.id].ultimoData).localeCompare(String(perThread[a.id].ultimoData));
    });
    var autori = righe.map(function (thread) { return thread.author_id; });
    righe.forEach(function (thread) { autori.push(perThread[thread.id].ultimoAutore); });
    await nomiUltimi(autori);
    var corpo = '<p class="forum-azioni"><a class="forum-linkbtn" href="' + href({ nuova: slug, macroarea: macroSlug }) + '">Nuova discussione</a></p>';
    if (!righe.length) {
      corpo += '<p class="vuoto">Nessuna discussione in questa macroarea.</p>';
    } else {
      corpo += '<div class="forum-elenco"><div class="forum-disc-testa" aria-hidden="true"><span>Discussione</span><span>Autore</span><span>Risposte</span><span>Ultima attività</span></div>';
      righe.forEach(function (thread) {
        var info = perThread[thread.id];
        var autore = schede[thread.author_id] || { nome: "Utente" };
        var ultimo = schede[info.ultimoAutore] || { nome: "Utente" };
        corpo += '<a class="forum-disc" href="' + href({ discussione: thread.id }) + '">';
        corpo += '<span class="forum-disc-titolo">' + escapeHtml(thread.titolo) + "</span>";
        corpo += '<span class="forum-disc-meta">' + escapeHtml(autore.nome) + "</span>";
        corpo += '<span class="forum-disc-meta">' + info.risposte + "</span>";
        corpo += '<span class="forum-disc-meta">' + escapeHtml(ultimo.nome) + "<br>" + escapeHtml(dataBreve(info.ultimoData)) + "</span>";
        corpo += "</a>";
      });
      corpo += "</div>";
    }
    pagina({
      titolo: categoria.nome,
      intro: categoria.descrizione,
      briciole: briciole([
        { testo: "Forum", href: href({}) },
        { testo: sezione.nome, href: href({ sezione: sezione.slug }) },
        { testo: categoria.nome }
      ]),
      corpo: corpo
    });
  }

  async function mostraDiscussione(id) {
    var thread = await client.from("threads").select("id, section_id, category_id, titolo, author_id, created_at").eq("id", id).maybeSingle();
    if (!thread.data) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: errore("Discussione non disponibile.") });
      return;
    }
    var sezione = await client.from("sections").select("id, slug, nome").eq("id", thread.data.section_id).maybeSingle();
    var categoria = thread.data.category_id
      ? await client.from("categories").select("id, slug, nome").eq("id", thread.data.category_id).maybeSingle()
      : { data: null };
    var messaggi = await client.from("posts").select("id, author_id, corpo, created_at").eq("thread_id", id).order("created_at");
    if (messaggi.error) {
      pagina({ titolo: thread.data.titolo, briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: errore("Messaggi non disponibili.") });
      return;
    }
    var messaggioDiAdmin = await autoreAdmin(thread.data.author_id);
    var blocchi = [];
    for (var i = 0; i < (messaggi.data || []).length; i++) {
      var post = messaggi.data[i];
      var scheda = await schedaAutore(post.author_id);
      if (scheda.ruolo === "Admin") messaggioDiAdmin = true;
      blocchi.push({ post: post, scheda: scheda });
    }
    var percorso = [{ testo: "Forum", href: href({}) }];
    if (sezione.data) percorso.push({ testo: sezione.data.nome, href: href({ sezione: sezione.data.slug }) });
    if (sezione.data && categoria.data) {
      percorso.push({ testo: categoria.data.nome, href: href({ sezione: sezione.data.slug, macroarea: categoria.data.slug }) });
    }
    percorso.push({ testo: thread.data.titolo });
    var corpo = '<p id="forum-avviso" class="forum-errore" role="alert" hidden></p>';
    if (eAdmin() || (eModeratore() && !messaggioDiAdmin)) {
      corpo += '<div class="forum-azioni"><button type="button" class="secondario" id="forum-cancella-thread">Cancella discussione</button></div>';
    }
    blocchi.forEach(function (blocco) {
      var classe = "forum-msg";
      if (blocco.scheda.ruolo === "Admin") classe += " forum-msg-admin";
      else if (blocco.scheda.ruolo === "Staff") classe += " forum-msg-staff";
      else if (blocco.scheda.ruolo === "Iscritto") classe += " forum-msg-iscritto";
      else classe += " forum-msg-registrato";
      corpo += '<article class="' + classe + '"><header><span class="forum-msg-nome">' + escapeHtml(blocco.scheda.nome) + "</span>";
      corpo += badge(blocco.scheda.ruolo);
      corpo += "<time>" + escapeHtml(dataBreve(blocco.post.created_at)) + "</time></header>";
      corpo += "<p>" + escapeHtml(blocco.post.corpo) + "</p>";
      if (eAdmin() || (eModeratore() && blocco.scheda.ruolo !== "Admin")) {
        corpo += '<div class="forum-azioni"><button type="button" class="secondario" data-cancella-post="' + blocco.post.id + '">Cancella messaggio</button></div>';
      }
      corpo += "</article>";
    });
    if (!profilo.blocked) {
      corpo += '<form id="forum-risposta" class="forum-box forum-form"><label for="risposta-corpo">Rispondi</label><textarea id="risposta-corpo" required maxlength="8000"></textarea>';
      corpo += '<div class="forum-azioni"><button type="submit">Pubblica risposta</button></div></form>';
    }
    pagina({ titolo: thread.data.titolo, briciole: briciole(percorso), corpo: corpo });
    var cancella = $("#forum-cancella-thread");
    if (cancella) cancella.addEventListener("click", function () {
      if (!window.confirm("Cancellare questa discussione e tutte le risposte?")) return;
      client.from("threads").delete().eq("id", id).then(function (esito) {
        if (esito.error) {
          var msg = $("#forum-avviso");
          msg.hidden = false;
          msg.textContent = "Discussione non cancellata.";
          return;
        }
        if (sezione.data && categoria.data) vai({ sezione: sezione.data.slug, macroarea: categoria.data.slug });
        else if (sezione.data) vai({ sezione: sezione.data.slug });
        else vai({});
      });
    });
    document.querySelectorAll("[data-cancella-post]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        client.from("posts").delete().eq("id", btn.getAttribute("data-cancella-post")).then(function (esito) {
          if (esito.error) {
            var msg = $("#forum-avviso");
            msg.hidden = false;
            msg.textContent = "Messaggio non cancellato.";
            return;
          }
          vai({ discussione: id });
        });
      });
    });
    var form = $("#forum-risposta");
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      client.from("posts").insert({ thread_id: id, author_id: profilo.id, corpo: $("#risposta-corpo").value.trim() }).then(function (esito) {
        if (esito.error) {
          var msg = $("#forum-avviso");
          msg.hidden = false;
          msg.textContent = "Risposta non pubblicata.";
          return;
        }
        vai({ discussione: id });
      }).catch(function () {
        var msg = $("#forum-avviso");
        msg.hidden = false;
        msg.textContent = "Risposta non pubblicata. Controlla la connessione e riprova.";
      });
    });
  }

  async function nuovaDiscussione(slug, macroSlug) {
    var sezioni = await client.from("sections").select("id, slug, nome").eq("slug", slug).maybeSingle();
    if (!sezioni.data) {
      pagina({ titolo: "Nuova discussione", briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: errore("Non puoi aprire una discussione in questa sezione.") });
      return;
    }
    var macro = await client.from("categories").select("id, slug, nome, ordine").eq("section_id", sezioni.data.id).order("ordine");
    if (mancaSchema(macro)) {
      pagina({ titolo: "Nuova discussione", briciole: briciole([{ testo: "Forum", href: href({}) }, { testo: sezioni.data.nome }]), corpo: avvisoSchema() });
      return;
    }
    var categorie = macro.data || [];
    var scelta = null;
    categorie.forEach(function (categoria) {
      if (categoria.slug === macroSlug) scelta = categoria;
    });
    if (!scelta) {
      categorie.forEach(function (categoria) {
        if (!scelta && categoria.slug === "generale") scelta = categoria;
      });
    }
    if (!scelta) scelta = categorie[0];
    if (!scelta) {
      pagina({
        titolo: "Nuova discussione",
        briciole: briciole([{ testo: "Forum", href: href({}) }, { testo: sezioni.data.nome, href: href({ sezione: sezioni.data.slug }) }]),
        corpo: errore("In questa sezione non c'è ancora una macroarea.")
      });
      return;
    }
    var percorso = [
      { testo: "Forum", href: href({}) },
      { testo: sezioni.data.nome, href: href({ sezione: sezioni.data.slug }) },
      { testo: scelta.nome, href: href({ sezione: sezioni.data.slug, macroarea: scelta.slug }) },
      { testo: "Nuova discussione" }
    ];
    pagina({
      titolo: "Nuova discussione",
      intro: sezioni.data.nome + " › " + scelta.nome,
      briciole: briciole(percorso),
      corpo:
        '<form id="forum-nuova" class="forum-box forum-form"><label for="nuova-titolo">Titolo</label><input id="nuova-titolo" required minlength="3" maxlength="180">' +
        '<label for="nuova-corpo">Messaggio</label><textarea id="nuova-corpo" required maxlength="8000"></textarea>' +
        '<div class="forum-azioni"><button type="submit">Apri discussione</button></div><p id="forum-avviso" class="forum-errore" role="alert" hidden></p></form>'
    });
    $("#forum-nuova").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = $("#forum-avviso");
      client.from("threads").insert({
        section_id: sezioni.data.id,
        category_id: scelta.id,
        author_id: profilo.id,
        titolo: $("#nuova-titolo").value.trim()
      }).select("id").single().then(function (esito) {
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
      }).catch(function () {
        msg.hidden = false;
        msg.textContent = "Discussione non creata. Controlla la connessione e riprova.";
      });
    });
  }

  function paginaRichiesta() {
    pagina({
      titolo: "Richiedi accesso iscritti",
      briciole: briciole([{ testo: "Forum", href: href({}) }, { testo: "Richiedi accesso iscritti" }]),
      intro: "La richiesta arriva allo staff del Gruppo Territoriale. Dopo l'approvazione potrai leggere e scrivere nell'Area iscritti M5S.",
      corpo:
        '<form id="forum-richiesta" class="forum-box forum-form"><label for="richiesta-testo">Messaggio per lo staff (facoltativo)</label>' +
        '<textarea id="richiesta-testo" maxlength="2000"></textarea>' +
        '<div class="forum-azioni"><button type="submit">Invia richiesta</button></div><p id="forum-avviso" class="forum-errore" role="alert" hidden></p></form>'
    });
    $("#forum-richiesta").addEventListener("submit", function (ev) {
      ev.preventDefault();
      client.from("access_requests").insert({
        user_id: profilo.id,
        messaggio: $("#richiesta-testo").value.trim(),
        stato: "in_attesa"
      }).then(function (esito) {
        var msg = $("#forum-avviso");
        msg.hidden = false;
        msg.textContent = esito.error ? "Richiesta non inviata. Forse ne hai già una in attesa." : "Richiesta inviata allo staff.";
      }).catch(function () {
        var msg = $("#forum-avviso");
        msg.hidden = false;
        msg.textContent = "Richiesta non inviata. Controlla la connessione e riprova.";
      });
    });
  }

  function opzioneRuolo(valore, etichetta, attuale) {
    return '<option value="' + valore + '"' + (attuale === valore ? " selected" : "") + ">" + etichetta + "</option>";
  }

  function schedePannello(attiva) {
    function voce(id, etichetta) {
      return '<a href="' + href({ pagina: "staff", scheda: id }) + '" role="tab" aria-selected="' + (attiva === id ? "true" : "false") + '">' + etichetta + "</a>";
    }
    var html = '<div class="forum-schede" role="tablist">' +
      voce("richieste", "Richieste di accesso") +
      voce("utenti", "Utenti e ruoli") +
      voce("macroaree", "Macroaree");
    if (eAdmin()) html += voce("newsletter", "Newsletter");
    return html + "</div>";
  }

  function csvCampo(valore) {
    var testo = String(valore == null ? "" : valore);
    if (/[;"\r\n]/.test(testo)) return '"' + testo.replace(/"/g, '""') + '"';
    return testo;
  }

  function etichettaOrigine(origine) {
    return origine === "lista_iniziale" ? "Lista iniziale" : "Sito";
  }

  function etichettaStato(riga) {
    return riga && riga.revocato_il ? "Disiscritto" : "Attivo";
  }

  function esportaNewsletter(lista) {
    var righe = ["email;iscritto_il;origine;stato"];
    (lista || []).forEach(function (riga) {
      righe.push(csvCampo(riga.email) + ";" + csvCampo(dataBreve(riga.creato_il)) + ";" + csvCampo(etichettaOrigine(riga.origine)) + ";" + csvCampo(etichettaStato(riga)));
    });
    var blob = new Blob(["\uFEFF" + righe.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "newsletter-iscritti.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function corpoNewsletter() {
    var esito = await client.from("newsletter_iscritti").select("id, email, creato_il, origine, revocato_il").order("creato_il", { ascending: false });
    if (esito.error) {
      var msg = String(esito.error.message || "") + " " + String(esito.error.details || "");
      if (esito.error.code === "PGRST205" || esito.error.code === "42P01" || msg.indexOf("newsletter_iscritti") !== -1) {
        return errore("La newsletter non è ancora attiva. Nel SQL Editor di Supabase esegui il file supabase/newsletter.sql.");
      }
      return errore("Non riesco a leggere gli iscritti alla newsletter.");
    }
    var lista = esito.data || [];
    iscrittiNewsletter = lista;
    var attivi = lista.filter(function (riga) { return !riga.revocato_il; }).length;
    var html = '<p class="forum-meta">' + conta(lista.length, "iscritto", "iscritti") + ", di cui " + conta(attivi, "attivo", "attivi") + ".</p>";
    html += '<div class="forum-azioni"><button type="button" id="newsletter-csv">Esporta CSV</button></div>';
    if (!lista.length) return html + '<p class="vuoto">Nessun iscritto.</p>';
    lista.forEach(function (riga) {
      html += '<article class="forum-card"><h3>' + escapeHtml(riga.email) + "</h3>";
      html += '<p class="forum-meta">' + escapeHtml(etichettaOrigine(riga.origine)) + " · " + escapeHtml(etichettaStato(riga));
      html += " · " + escapeHtml(dataBreve(riga.creato_il));
      if (riga.revocato_il) html += " · disiscritto il " + escapeHtml(dataBreve(riga.revocato_il));
      html += "</p>";
      html += '<div class="forum-azioni"><button type="button" class="secondario" data-elimina-newsletter="' + riga.id + '" data-email="' + escapeHtml(riga.email) + '">Elimina</button></div></article>';
    });
    return html;
  }

  function schedaUtente(utente) {
    var html = '<article class="forum-card"><h3>' + escapeHtml(utente.display_name) + " " + badge(etichettaRuolo(utente.role)) + "</h3>";
    html += '<p class="forum-meta">' + escapeHtml(utente.email) + "</p>";
    if (utente.role === "admin" || (!eAdmin() && utente.role === "staff")) {
      return html + '<p class="forum-meta">Ruolo protetto.</p></article>';
    }
    html += '<form class="forum-form" data-utente="' + utente.id + '">';
    html += '<label>Ruolo<select data-ruolo>';
    html += opzioneRuolo("registrato", "Registrato", utente.role);
    html += opzioneRuolo("iscritto", "Iscritto", utente.role);
    if (eAdmin()) html += opzioneRuolo("staff", "Staff", utente.role);
    html += "</select></label>";
    html += '<label><input type="checkbox" data-blocco' + (utente.blocked ? " checked" : "") + "> Account bloccato</label>";
    html += '<div class="forum-azioni"><button type="submit">Salva</button></div></form></article>';
    return html;
  }

  async function corpoRichieste() {
    var richieste = await client.from("access_requests").select("id, user_id, messaggio, stato, created_at").eq("stato", "in_attesa").order("created_at");
    if (richieste.error) return errore("Non riesco a leggere le richieste.");
    if (!(richieste.data || []).length) return '<p class="vuoto">Nessuna richiesta in attesa.</p>';
    var html = "";
    for (var i = 0; i < richieste.data.length; i++) {
      var richiesta = richieste.data[i];
      var scheda = await schedaAutore(richiesta.user_id);
      html += '<article class="forum-card"><h3>' + escapeHtml(scheda.nome) + "</h3>";
      html += '<p class="forum-meta">' + escapeHtml(dataBreve(richiesta.created_at)) + "</p>";
      html += "<p>" + escapeHtml(richiesta.messaggio || "Nessun messaggio.") + "</p>";
      html += '<div class="forum-azioni"><button type="button" data-approva="' + richiesta.id + '">Approva come iscritto</button>';
      html += '<button type="button" class="secondario" data-rifiuta="' + richiesta.id + '">Rifiuta</button></div></article>';
    }
    return html;
  }

  async function corpoUtenti() {
    var utenti = await client.from("profiles").select("id, email, display_name, role, blocked").order("created_at");
    if (utenti.error) return errore("Non riesco a leggere gli utenti.");
    var html = "";
    if (eAdmin()) html += '<p class="forum-meta">Solo l\'admin può nominare o togliere lo staff. Nessuno può nominare un altro admin da qui.</p>';
    else html += '<p class="forum-meta">Puoi approvare gli iscritti. Lo staff e l\'admin restano protetti.</p>';
    (utenti.data || []).forEach(function (utente) { html += schedaUtente(utente); });
    if (!(utenti.data || []).length) html += '<p class="vuoto">Nessun utente.</p>';
    return html;
  }

  async function corpoMacroaree() {
    var sezioni = await client.from("sections").select("id, slug, nome, ordine").order("ordine");
    var macro = await client.from("categories").select("id, section_id, slug, nome, descrizione, ordine").order("ordine");
    var threads = await client.from("threads").select("category_id");
    if (mancaSchema(macro)) return avvisoSchema();
    if (sezioni.error || macro.error || threads.error) return errore("Non riesco a leggere le macroaree.");
    var occupate = {};
    (threads.data || []).forEach(function (thread) {
      occupate[thread.category_id] = (occupate[thread.category_id] || 0) + 1;
    });
    var html = '<form id="forum-nuova-macro" class="forum-box forum-form forum-macro-nuova"><h2>Nuova macroarea</h2>';
    html += '<div class="forum-campi"><label>Sezione<select id="macro-sezione">';
    (sezioni.data || []).forEach(function (sezione) {
      html += '<option value="' + sezione.id + '">' + escapeHtml(sezione.nome) + "</option>";
    });
    html += '</select></label><label>Titolo<input id="macro-nome" required minlength="2" maxlength="80"></label>';
    html += '<label>Descrizione breve<input id="macro-desc" maxlength="240"></label></div>';
    html += '<div class="forum-azioni"><button type="submit">Crea macroarea</button></div></form>';
    (sezioni.data || []).forEach(function (sezione) {
      var categorie = (macro.data || []).filter(function (categoria) { return categoria.section_id === sezione.id; });
      categorie.sort(function (a, b) { return a.ordine - b.ordine || String(a.nome).localeCompare(String(b.nome), "it"); });
      html += '<section class="forum-box forum-macro-blocco"><h2>' + escapeHtml(sezione.nome) + "</h2>";
      if (!categorie.length) html += '<p class="vuoto">Nessuna macroarea.</p>';
      categorie.forEach(function (categoria) {
        var n = occupate[categoria.id] || 0;
        html += '<form class="forum-form forum-macro-riga" data-macro="' + categoria.id + '" data-discussioni="' + n + '">';
        html += '<label>Titolo<input name="nome" required minlength="2" maxlength="80" value="' + escapeHtml(categoria.nome) + '"></label>';
        html += '<label>Descrizione<input name="descrizione" maxlength="240" value="' + escapeHtml(categoria.descrizione) + '"></label>';
        html += '<label>Ordine<input name="ordine" type="number" step="1" value="' + categoria.ordine + '"></label>';
        html += '<div class="forum-azioni"><button type="submit">Salva</button>';
        html += '<button type="button" class="secondario" data-elimina-macro="' + categoria.id + '">Elimina</button></div>';
        html += '<p class="forum-meta">' + conta(n, "discussione", "discussioni") + "</p></form>";
      });
      html += "</section>";
    });
    return html;
  }

  function collegaPannello(scheda) {
    var avviso = $("#forum-avviso");
    function segnala(testo) {
      if (!avviso) return;
      avviso.hidden = !testo;
      avviso.textContent = testo || "";
    }
    document.querySelectorAll("[data-approva]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        client.rpc("forum_decidi_richiesta", { richiesta: btn.getAttribute("data-approva"), approva: true }).then(function (esito) {
          if (esito.error) {
            segnala("Richiesta non approvata.");
            return;
          }
          vai({ pagina: "staff", scheda: "richieste" });
        });
      });
    });
    document.querySelectorAll("[data-rifiuta]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        client.rpc("forum_decidi_richiesta", { richiesta: btn.getAttribute("data-rifiuta"), approva: false }).then(function (esito) {
          if (esito.error) {
            segnala("Richiesta non rifiutata.");
            return;
          }
          vai({ pagina: "staff", scheda: "richieste" });
        });
      });
    });
    document.querySelectorAll("form[data-utente]").forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        client.from("profiles").update({
          role: form.querySelector("[data-ruolo]").value,
          blocked: form.querySelector("[data-blocco]").checked
        }).eq("id", form.getAttribute("data-utente")).then(function (esito) {
          if (esito.error) {
            segnala("Modifica non salvata.");
            return;
          }
          vai({ pagina: "staff", scheda: "utenti" });
        });
      });
    });
    var nuova = $("#forum-nuova-macro");
    if (nuova) nuova.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var sectionId = $("#macro-sezione").value;
      var nome = $("#macro-nome").value.trim();
      client.from("categories").select("slug").eq("section_id", sectionId).then(function (esistenti) {
        if (esistenti.error) {
          segnala("Macroarea non creata.");
          return;
        }
        var slug = slugLibero(slugifica(nome), esistenti.data || []);
        var ordine = ((esistenti.data || []).length + 1);
        client.from("categories").insert({
          section_id: sectionId,
          slug: slug,
          nome: nome,
          descrizione: $("#macro-desc").value.trim(),
          ordine: ordine
        }).then(function (esito) {
          if (esito.error) {
            segnala("Macroarea non creata. Controlla titolo e descrizione.");
            return;
          }
          vai({ pagina: "staff", scheda: "macroaree" });
        });
      });
    });
    document.querySelectorAll("form[data-macro]").forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        client.from("categories").update({
          nome: form.querySelector("[name=nome]").value.trim(),
          descrizione: form.querySelector("[name=descrizione]").value.trim(),
          ordine: Number(form.querySelector("[name=ordine]").value || 0)
        }).eq("id", form.getAttribute("data-macro")).then(function (esito) {
          if (esito.error) {
            segnala("Modifica non salvata. Controlla titolo e descrizione.");
            return;
          }
          vai({ pagina: "staff", scheda: "macroaree" });
        });
      });
    });
    document.querySelectorAll("[data-elimina-macro]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var form = btn.closest("form");
        var n = Number(form ? form.getAttribute("data-discussioni") : 0);
        if (n > 0) {
          segnala("Questa macroarea ha ancora discussioni: non si può eliminare.");
          return;
        }
        if (!window.confirm("Eliminare questa macroarea?")) return;
        client.from("categories").delete().eq("id", btn.getAttribute("data-elimina-macro")).then(function (esito) {
          if (esito.error) {
            segnala("Macroarea non eliminata.");
            return;
          }
          vai({ pagina: "staff", scheda: "macroaree" });
        });
      });
    });
    var csv = $("#newsletter-csv");
    if (csv) csv.addEventListener("click", function () {
      esportaNewsletter(iscrittiNewsletter);
    });
    document.querySelectorAll("[data-elimina-newsletter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var email = btn.getAttribute("data-email") || "questo indirizzo";
        if (!window.confirm("Eliminare " + email + " dalla newsletter?")) return;
        client.from("newsletter_iscritti").delete().eq("id", btn.getAttribute("data-elimina-newsletter")).then(function (esito) {
          if (esito.error) {
            segnala("Iscritto non eliminato.");
            return;
          }
          vai({ pagina: "staff", scheda: "newsletter" });
        });
      });
    });
    if (scheda) return;
  }

  async function pannello() {
    if (!eModeratore()) {
      pagina({ titolo: "Forum", briciole: briciole([{ testo: "Forum", href: href({}) }]), corpo: errore("Pannello riservato allo staff del gruppo.") });
      return;
    }
    var stato = hash();
    var schedeValide = { utenti: true, macroaree: true };
    if (eAdmin()) schedeValide.newsletter = true;
    var scheda = schedeValide[stato.scheda] ? stato.scheda : "richieste";
    var titolo = eAdmin() ? "Pannello admin" : "Pannello staff";
    var corpo = schedePannello(scheda) + '<p id="forum-avviso" class="forum-errore" role="alert" hidden></p>';
    if (scheda === "utenti") corpo += await corpoUtenti();
    else if (scheda === "macroaree") corpo += await corpoMacroaree();
    else if (scheda === "newsletter") corpo += await corpoNewsletter();
    else corpo += await corpoRichieste();
    pagina({
      titolo: titolo,
      briciole: briciole([{ testo: "Forum", href: href({}) }, { testo: titolo }]),
      corpo: corpo
    });
    collegaPannello(scheda);
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
    try {
      await caricaProfilo();
    } catch (e) {
      schermataAccesso("Non riesco a verificare l'accesso. Controlla la connessione e riprova.");
      return;
    }
    if (!profilo) {
      schermataAccesso("");
      return;
    }
    if (profilo.blocked) {
      pagina({
        titolo: "Forum",
        briciole: briciole([{ testo: "Forum" }]),
        corpo: errore("Il tuo account è bloccato. Non puoi leggere né scrivere nel forum.")
      });
      return;
    }
    var stato = hash();
    if (stato.pagina === "staff") return pannello();
    if (stato.pagina === "richiesta") return paginaRichiesta();
    if (stato.discussione) return mostraDiscussione(stato.discussione);
    if (stato.nuova) return nuovaDiscussione(stato.nuova, stato.macroarea);
    if (stato.sezione && stato.macroarea) return elencoDiscussioni(stato.sezione, stato.macroarea);
    if (stato.sezione) return vistaSezioni(stato.sezione);
    return vistaSezioni("");
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
