# Istruzioni per il proprietario

Sito del **Gruppo Territoriale Lepini Ausoni – Movimento 5 Stelle**.
Indirizzo pubblico: https://damilunch-jpg.github.io/

Il sito è fatto di pagine HTML statiche. Chi lo visita non installa nulla.
Gli articoli si scrivono dal browser, con [Pages CMS](https://pagescms.org/).
Ogni salvataggio pubblica subito, senza un passaggio di approvazione.
GitHub conserva chi ha creato, modificato o cancellato ciascun file.

In questa fase il sito chiede ai motori di ricerca di non indicizzarlo
(`robots.txt` e il meta `noindex`). Si potrà togliere quando la prova sarà finita.

---

## 1. Cosa deve fare il proprietario, una volta sola

Queste operazioni le può fare solo il proprietario dell'account GitHub `damilunch-jpg`.
Non si possono completare al posto suo.

### 1.1 Pubblicazione su GitHub Pages

Se https://damilunch-jpg.github.io/ non mostra ancora il sito:

1. Apri il repository [damilunch-jpg/damilunch-jpg.github.io](https://github.com/damilunch-jpg/damilunch-jpg.github.io).
2. Vai in **Settings → Pages**.
3. In **Build and deployment** scegli **Deploy from a branch**.
4. Branch: **main**. Cartella: **/ (root)**.
5. Salva. La prima pubblicazione può richiedere qualche minuto.

### 1.2 Permesso di scrittura per le azioni automatiche

Due azioni GitHub tengono aggiornato il sito:

- **Aggiorna indice articoli**: dopo ogni articolo nuovo o modificato ricostruisce `js/articles.js`.
- **Sincronizza albi pretori**: di notte, fra mezzanotte e le 5 ora di Roma, legge gli albi. Alle 00:00 li legge tutti; all'01:00, alle 02:30 e alle 04:00 riprova solo i comuni che erano falliti o vuoti. Le richieste sono una alla volta, con pause, quindi il lavoro può durare a lungo.

Se un'azione fallisce con un errore di permesso (`403` in fase di `git push`):

1. **Settings → Actions → General**.
2. In **Workflow permissions** scegli **Read and write permissions**.
3. Salva.

### 1.3 Collegare Pages CMS

1. Apri **https://app.pagescms.org**.
2. Scegli **Sign in with GitHub** e autorizza l'accesso.
3. Se GitHub chiede di installare l'applicazione **Pages CMS**, installala sull'account `damilunch-jpg` e seleziona il repository `damilunch-jpg.github.io` (basta questo repository, non serve darla a tutti).
4. Nell'elenco apri il repository e il branch **main**.
5. Devi vedere la raccolta **Articoli**.

Da quel momento l'editor è pronto. L'indirizzo di accesso, anche per i publisher, è sempre:

**https://app.pagescms.org**

---

## 2. Entrare nell'editor

1. Vai su https://app.pagescms.org.
2. Accedi con GitHub (lo stesso account che ha il permesso di scrittura sul repository).
3. Apri `damilunch-jpg / damilunch-jpg.github.io`, branch **main**.
4. Apri **Articoli**.

I tre articoli già presenti sono contrassegnati come **Articolo di esempio**.
Si possono cancellare quando non servono più: apri l'articolo e usa **Elimina**.

---

## 3. Pubblicare un articolo

1. In **Articoli** scegli **Nuovo** (o l'equivalente «Create»).
2. Compila i campi:
   - **Titolo**
   - **Data** (giorno di pubblicazione)
   - **Comune** (Cori, Cisterna di Latina, Norma, Sezze, Bassiano, Roccagorga, Priverno o Sonnino)
   - **Estratto** (poche righe, quelle che si vedono in homepage)
   - **Articolo di esempio**: lascialo spento per un articolo vero
   - **Immagine**: facoltativa
   - **Testo**: il corpo dell'articolo. Si possono usare titoli, elenchi, grassetto e link
3. Controlla il nome del file proposto (lo vedi solo alla creazione). Va bene quello suggerito.
4. Salva.

Non c'è una coda di approvazione. Il salvataggio scrive il file in `content/articoli/` sul branch `main`.
Entro un paio di minuti l'azione **Aggiorna indice articoli** rigenera l'elenco e l'articolo compare sul sito:
in homepage e nella pagina del comune scelto.

L'indirizzo dell'articolo è `articolo.html?id=` seguito dal nome del file, senza `.md`.

---

## 4. Modificare un articolo

1. Entra in https://app.pagescms.org come al punto 2.
2. Apri **Articoli** e scegli l'articolo.
3. Modifica i campi e salva.

Vale per qualunque articolo, anche quelli scritti da un altro publisher.
Il proprietario del repository può sempre correggere o riscrivere tutto.

---

## 5. Cancellare un articolo

1. Entra nell'editor, apri l'articolo e scegli **Elimina**.
2. Conferma.

In alternativa, su GitHub, apri `content/articoli/`, apri il file e usa **Delete**.

L'articolo sparisce dal sito al giro successivo dell'indice.
La cancellazione resta nella cronologia di Git: **Insights → Network** oppure la storia del file,
da cui si vede chi lo ha tolto. Si può anche ripristinare un file dalla cronologia, se serve.

---

## 6. Aggiungere un publisher

Un publisher è una persona che può creare e modificare articoli senza toccare il codice.
Può essere una per comune, oppure qualcuno in più: il numero non è fisso.
Si aggiunge e si toglie quando si vuole.

Pages CMS non ha un permesso «solo questo comune» se la pubblicazione deve essere immediata,
senza approvazione. Chi ha l'accesso può scrivere articoli per qualsiasi comune
(il campo **Comune** dice a quale pagina va l'articolo).
Il proprietario vede comunque, nella cronologia di Git, chi ha fatto ogni modifica,
e può correggere o cancellare qualsiasi articolo.

### Aggiungere una persona che ha un account GitHub

1. Apri il repository su GitHub.
2. **Settings → Collaborators** (in alcuni account: **Collaborators and teams**).
3. **Add people**.
4. Cerca il nome utente GitHub della persona.
5. Ruolo: **Write** (scrittura). Non serve **Admin**: l'amministratore resta il proprietario.
6. La persona accetta l'invito dalla mail o dalle notifiche GitHub.
7. Poi entra su https://app.pagescms.org con **il proprio** account GitHub e apre questo repository.

Da quel momento può pubblicare subito.

### Aggiungere una persona senza account GitHub

Pages CMS permette anche un invito via e-mail, gestito dentro l'editor
(voce collaboratori / collaborators, visibile solo a chi amministra il repository).
Quella persona entra su https://app.pagescms.org con l'e-mail dell'invito,
senza imparare Git. I suoi salvataggi risultano a nome dell'applicazione Pages CMS,
con nome ed e-mail nel messaggio di commit quando disponibili.

Per togliere questo tipo di accesso si usa la stessa schermata dell'editor, non solo GitHub.

---

## 7. Togliere l'accesso a un publisher

### Se è un collaboratore GitHub

1. **Settings → Collaborators**.
2. Accanto al nome, **Remove** (rimuovi).

Da subito non può più salvare articoli. Quelli già pubblicati restano,
finché qualcuno con accesso non li cancella.

### Se era stato invitato solo dentro Pages CMS

1. Entra su https://app.pagescms.org con l'account del proprietario.
2. Apri la gestione dei collaboratori del repository.
3. Rimuovi l'invito o la persona.

---

## 8. Albo pretorio

Ogni notte, fra le **00:00 e le 05:00 ora di Roma** (ora solare e ora legale),
l'azione **Sincronizza albi pretori** legge gli albi degli otto comuni.
A mezzanotte li interroga tutti. All'01:00, alle 02:30 e alle 04:00 riprova
solo quelli falliti o rimasti senza atti. Un elenco già riuscito non viene
sostituito con una risposta vuota, e se il sito non risponde resta l'elenco precedente.

Sulla pagina di ciascun comune compaiono:

- il pulsante verso l'albo ufficiale;
- **Ultimo aggiornamento** con data e ora, oppure **Fonte non raggiungibile** se quel giorno il sito del Comune non ha risposto;
- gli atti più recenti (al massimo 30): titolo, data di pubblicazione, tipo e numero quando ci sono, e il link all'atto originale.

I PDF restano sul sito del Comune: qui c'è solo il collegamento.
Se una fonte non risponde, le altre vengono aggiornate lo stesso.
Gli atti già raccolti restano in pagina, con la nota che la fonte non era raggiungibile.

Per lanciare una lettura subito, senza aspettare la mezzanotte:

1. Nel repository, scheda **Actions**.
2. A sinistra, **Sincronizza albi pretori**.
3. **Run workflow**, branch **main**, poi **Run workflow**.

Fonti usate:

| Comune | Lettura |
| --- | --- |
| Cori | Albo URBI del Comune |
| Cisterna di Latina | Albo Halley (`halleyweb`) collegato dalla pagina comunale |
| Norma | Albo Halley indicato in homepage come «Albo Pretorio» (`halleyweb.com/c059016`, servizio 304) |
| Sezze | Albo Halley aperto dal pulsante «Accedi al servizio» della scheda Albo pretorio su comune.sezze.lt.it (`halleyweb.com/c059028/mc/mc_gridev_messi.php`) |
| Bassiano | Albo URBI del Comune |
| Roccagorga | Albo sulla Gazzetta Amministrativa, link ufficiale nel piè del sito comunale (`comuneroccagorga.it` al momento non risolve; il sito che risponde è `www.comune.roccagorga.lt.it`) |
| Priverno | Scheda «Albo pretorio» su ServiziOnLine; in alternativa l'albo Halley del Comune |
| Sonnino | Albo URBI del Comune (`DB_NAME=n1201895`) |

Una lettura veloce del 18 novembre 2026 ha raccolto atti per Cori (30), Bassiano (30), Roccagorga (15), Cisterna di Latina (7) e Priverno (10). Norma e Sezze avevano risposto con un elenco Halley vuoto. Una lettura successiva, lenta e una richiesta alla volta, ha di nuovo letto Cori, Bassiano e Roccagorga, mentre Halley ha chiuso ogni collegamento (Cisterna, Norma, Sezze, Priverno): gli atti già salvati restano in pagina con la nota «Fonte non raggiungibile». Sonnino segnala che il portale è in manutenzione. Le prove notturne (01:00, 02:30, 04:00) ritentano solo i comuni ancora vuoti o falliti.

---

## 9. Dove stanno i file, se serve guardarli

- `content/articoli/` — un file Markdown per articolo
- `js/articles.js` — indice generato, quello che legge il sito
- `data/albo.json` e `js/albo.js` — atti letti dagli albi
- `data/comuni.json` — nomi dei comuni e indirizzi degli albi
- `.pages.yml` — campi dell'editor

Non modificare `js/articles.js` e `js/albo.js` a mano: alla prossima azione vengono riscritti.
