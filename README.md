# Brat Ltd. – KantoBay Shop (Startversion)

## Starten
1. ZIP entpacken.
2. `index.html` im Browser öffnen.
3. Die Seite funktioniert als Frontend-Demo ohne Server.

## Bereits enthalten
- Amazon-inspirierte Shop-Oberfläche
- Suche und Kategorien
- Beispielprodukte für Blöcke, Items, Rüstung, Verzauberungen und Dienstleistungen
- Warenkorb mit Mengensteuerung
- konfigurierbare Beispiel-Mengenrabatte in `app.js`
- Währung KB$
- Bestellanfrage als herunterladbare Textdatei

## Wichtig: Noch kein echter Live-Shop
Diese Version speichert den Warenkorb nur lokal im Browser. Bestellanfragen werden nicht automatisch an Brat Ltd. übermittelt. Es gibt noch keine Konten, keine sichere Admin-Oberfläche, keine Datenbank und keine automatische Abbuchung von KB$.

Für den echten Betrieb folgt als nächster Schritt:
1. Supabase-Datenbank für Produkte, Rabattstaffeln, Bestellungen und Nutzer.
2. Geschützter Adminbereich mit Rollen und Row Level Security.
3. Bestellstatus und Kundenkonten.
4. Optional Paper-Plugin/API für automatische Übergabe bzw. Kontostandsprüfung.

## Preise ändern
In `app.js` oben im Array `products`:
- `price`: Grundpreis pro Stück in KB$
- `discounts`: Mengenstaffeln, z. B. `{min: 64, price: 1.8}`
Alle Beispielpreise sind Platzhalter und sollten vor dem Start angepasst werden.
