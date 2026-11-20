/**
 * Where things are in CannaTrace and how common jobs are done, so Tally can answer "how do I…?"
 * questions with real steps. Keep this in step with the sidebar (src/app/(app)/layout.tsx) and the
 * page and card titles it names. It describes the screens; Tally still uses tools for live data.
 */
export const APP_GUIDE = `CannaTrace app guide (the sidebar on the left, tabs across the top of each page; names below are exactly what's on screen):

Dashboard: "Needs attention today" at the top lists what to do now, most urgent first (urgent alerts, failed state reports, expired vendor licenses, quarantined packages, orders to pick, ship, or mark delivered, harvests waiting for a dry weight, packages on hold, licenses expiring within 30 days), each linking to where it's done. Below it: today's numbers, Tally Watch findings, sales by day. Quick buttons: New sale, Receive, Count, Orders, Plants.

Cultivation (tabs: Overview, Plants, Harvests, Strains)
- Add a strain: Cultivation → Strains → "Add a strain".
- Start a batch of clones or seeds: Cultivation → Overview → "Start a batch" (name, strain, clones or seeds, how many, room).
- Tag plants: open the batch from "Plant batches" on Overview → "Tag plants" (scan or type tags, or a first tag and a count). "Record lost plants" is on the same page.
- Change phase, move, harvest, or destroy plants: Cultivation → Plants → tick plants ("Tick or untick all" for everything shown) → "Choose what to do" → "Apply to ticked plants". Filter by phase, room, or strain first.
- A harvest: Cultivation → Harvests → open it. The top shows wet and dry weight, packaged, waste, and "Left to account for", with a bar and the next step. Then "Record dry weight", "Log waste", "Package from this harvest" (set "How many packages" to make several same-size packages in one save, e.g. ten 1 lb bags; leave the tag blank or give one tag per package), then "Finish harvest" once every gram is packaged or logged. A harvest can't be finished until its dry weight is recorded. Package it as an item of the same strain (or an item with no strain set, such as mixed trim); another strain's item is refused.
- Finished a harvest by mistake: open it → "Reopen harvest" (say why; it's saved in the audit trail), then finish it again when it's done.
- Tasks: Cultivation → Overview → "Add a task"; press Done on "Open tasks" when finished.

Inventory (tabs: Packages, Receive, Counts, Items, Locations)
- Find a package: Inventory → Packages, search by tag, item, or lot, filter by status. Open it to see its history and lab results. Search at the top of the page looks at the facility you're working in; switch facility to find another facility's stock.
- Lab results: a failed test stands until a later test passes. A newer "pending" result does not release it. A failed package can't be split, merged, sold, shipped, or used in production, and packages already made from it are put in quarantine too. To release it: record the passing retest, then "Hold, quarantine, or destroy" → back to active.
- Destroying waste: put the package on hold or in quarantine first; it can be destroyed once the state's waiting period has passed (the package page says when).
- On a package page: "Move", "Adjust quantity", "Split into new packages", "Merge with other packages", "Hold, quarantine, or destroy", "Add lab result" (with a section for the full cannabinoid profile and terpenes), "Print package label", "Print product label".
- Many packages at once: on Inventory → Packages, tick the packages (or "Tick or untick all"), then in "With the ticked packages" choose move to another location, put on hold, put in quarantine, release, or print labels, and press "Apply to ticked packages". It's all or nothing: if one ticked package can't change (say it failed its lab test), nothing changes and the message names that package's tag.
- One lab result for a whole lot: on any package page, "Add lab result" lists the rest of its lot under "Same test, rest of lot", all ticked. Save once and the result and COA are recorded on every ticked package; a fail quarantines each of them.
- Receive new packages: Inventory → Receive. A whole shipment: Inventory → Receive → "Receive it against the manifest" (upload the seller's manifest, count what arrived, explain anything short or missing). A shipment from another of this business's own facilities is received the same way with that order's manifest number: the same packages move over, keeping their tags, lots, and lab results. Leave the tag blank and CannaTrace makes a new unique ID (PKG-000123); the same goes for splits, merges, harvest packages, and production runs. Leave the SKU blank on "Add an item" to get one like FLO-0007; change it under "Name and SKU" on the item.
- Count a room or shelf: Inventory → Counts → "Count a location". Items counted "each" take whole numbers only.
- Products: Inventory → Items → "Add an item" or "Add a category". "Label details" on each item holds unit weight, servings and mg per serving, shelf life, refrigeration, directions, ingredients, allergens, pesticides, and solvents for product labels.
- Racks and bins: Inventory → Locations → "Add a location".
- Rooms with an area type (Propagation, Vegetative, Flowering, Harvest, Drying & Trimming, Inventory, Quarantine, Waste): Settings → Facilities → the facility's card → "Add a room"; each room has Edit to rename it or change its area.

Manufacturing (tabs: Production runs, Recipes; for people who run production or review records)
- Recipes → "New recipe" (output item and quantity, and what goes in).
- Production runs → "Start a run" → open it → "Add an input" (scan the package tags used) → "Complete the run" (new tag, actual quantity, room).

Distribution (tabs: Orders, Invoices, Vendors, Price lists, Drivers and vehicles)
- Vendors → "Add a vendor" (license number and expiry; verify the license before shipping). A vendor can have several destinations.
- Price lists → "New price list", "Set a price".
- An order page shows its progress across the top (Draft, Confirmed, Packed, Shipped, Delivered) with the next step underneath.
- Distribution → Orders lists orders under "In progress", "On the road", and "Done", each with what it's waiting on (ready to pick, ready to ship, out for delivery).
- Orders → "Start an order" → "Add a line" → "Confirm the order" → "Pick packages" ("Pick everything, oldest first" fills every line from the oldest active packages, splitting off just what's needed, skipping held or failed stock, and saying which items are short; "Or scan one package" picks them one at a time) → "Mark packed" → "Ship" (driver, vehicle, times; makes the manifest) → "Mark delivered".
- Invoices → "Record a payment" or "Issue a credit memo".
- Drivers and vehicles → "Add a driver", "Add a vehicle".

Register (tabs: Register, Pickups, Cash drawer, Menu and store rules)
- The Register only appears at facilities that sell (retail stores and microbusinesses).
- Before selling, a manager enters purchase limits and tax rates under Register → Menu and store rules ("Store rules"); the register stays locked until then. Menu prices: "Add or change a menu item"; to change only the price, leave "Counts toward which purchase limit" on "Keep" so the item's purchase limit stays as it is. Prices are whole cents. Discounts: "Add a discount"; take one away with "Remove" next to it under "Discounts". Open carts pick up a new shelf price on their next change.
- Cash drawer: each person opens their own at the start of their shift and closes it with a count at the end. Clerks count blind; managers see every open drawer and can close one someone left open. A drawer with carts still in it can't be closed: finish or cancel them first.
- Online menu and pickups: under Menu and store rules → "Online menu and pickups", a manager turns on a public menu page for the store (at /menu/ plus the address they choose) and chooses whether customers can reserve for pickup. The page shows only what the register could sell right now, at shelf prices, never stock counts, and asks visitors to confirm they are 21 or older. Reservations show on the Pickups tab (and as a banner on the Register). A reservation takes nothing out of stock. When the customer arrives, "Customer is here: check ID and start the sale" checks their ID and opens a cart with the reserved items; anything sold out since or over a purchase limit is left out and listed. "Mark ready" and "Cancel" are also there. Payment and ID checks always happen in the store.
- Card payments: CannaTrace records card payments but does not charge cards or connect to a card processor. The budtender runs the card on the store's own terminal first, then chooses Debit (or Split) and presses Complete sale. Optional: "Last 4 digits" and "Approval number" from the terminal; they show on the receipt and under "Card payments this shift" on the end-of-day report, to match the terminal's batch report. Never the whole card number.
- Held carts: your own are under "Held carts" on the Register. Carts held on someone else's drawer are listed there as "Take over"; taking one over moves it to your drawer, so the cash goes in the till you'll count. It's recorded in the audit trail.
- A sale: Register → check the customer's ID (date of birth and expiry) → add items (search or scan) → take payment. Past sales open from the register; "Return items" and "Void this sale" are on the sale. Once part of a sale has been returned it can't be voided; return the rest instead. Returns of items counted "each" take whole numbers. The tiles show how much can actually be sold (lab-cleared where the state requires it).

SmartLabel AI (tabs: Print, Templates, Printers, History)
- Print: choose the label type (Plant tag, Batch label, Package label, Product label, Transfer label) → template → tick records → "Check and preview" → print.
- When labels can't print: "Show what to fix" jumps to the problems, and each one links to where it's fixed (the record's page, or "Fix it in the template" for a design problem such as a missing state logo image). If only some labels are blocked, "Leave them out and print the other N" prints the rest. After fixing something in another tab, press "I fixed it, check again".
- Templates: edit or duplicate a design; "Insert a field" adds data such as net weight, lot, harvest batch, cannabinoid profile. New Mexico product labels need the state's cannabis logo uploaded once.
- Printers: save a printer and nudge the alignment; print a test label.

Show me how (SmartWorkflows): the "Show me how" button at the top right of the Dashboard opens guided walkthroughs that highlight each step, page to page, on the business's real data: Harvest to shelf, Start a grow, Make a product, Fill a wholesale order, Receive a delivery, Run a register shift, Find and move a package, Count a room, Hold and destroy waste, Your morning check with Tally. When someone asks how to do one of those jobs, give the steps and mention they can press Show me how and pick it to be walked through. A link like /dashboard?walk=harvest-to-shelf starts one directly (ids: harvest-to-shelf, start-a-grow, make-a-product, fill-an-order, receive-delivery, register-shift, find-and-move, count-a-room, hold-and-destroy, morning-check).
Reports (tabs: Reports, Import and export): inventory value and age, retail sales (with refunds and net sales by day; the Dashboard's sales are also net of refunds), wholesale, harvest and production yields. Import and export downloads spreadsheets (CSV) of packages, items, locations, customers, invoices, retail sales, and the audit trail, and uploads items, locations, customers, and opening inventory. "Switch from NMS2S", "Switch from Dutchie" and "Switch from Flourish" on the same page load an inventory list from those systems (NMS2S, New Mexico's state system: an Inventory Room's list with its column names, ID column formatted as Text so Excel keeps all 16 digits; Dutchie: Reports → Current Inventory; Flourish: Inventory → All Packages; Excel or CSV): products, rooms, and packages with their tags, batches, quantities, and costs. Press "Check the file" first; nothing is saved until "Import". THC and CBD come across as pending lab results to confirm. Spreadsheet uploads match existing locations and categories regardless of capital letters.

Compliance (tabs: State reporting, State rules, Audit trail): the state track-and-trace system for this facility and what's waiting to send; the state's rules CannaTrace enforces and anything to fix; every change, who made it, and when.
- Audit trail: search by tag, number, name, or reason, filter by "Person" and "Kind of record", open "What changed" on an entry, and use "Older" and "Newer" to page back. Entries can't be edited or deleted. Changing the state system, retrying or marking a state record handled, and API key or webhook changes are recorded too.

Settings (tabs: Business, Facilities, Team, Integrations, Tally AI)
- Business: the business name.
- Facilities: add a facility, edit its license and state, switch facilities, add rooms, and (for owners) load a sample facility with practice data.
- Team: "Invite someone" (sends a one-time link), change roles, build custom roles, make a password reset link for a person, and "Works at" to limit a person to some facilities.
- Integrations: API keys and webhooks.
- Tally AI: connect the business's Claude account and set limits. "Usage" shows questions asked, "Estimated cost this month" in dollars (with the average per answered question and last month's total), and each person's questions and cost. Costs are estimates from Anthropic's list prices for the model used, counting only questions on the business's own key; exact charges are in the Claude Console.
- Switch facility: the menu at the top of every page. Change your own password or sign out: the account menu (your initials) at the top right.
- Tally Watch: the bell at the top right, or the Tally Watch card on the Dashboard. To compare with the state: Tally Watch → "Match against the state system" → upload the state's package export → "Upload and compare". Differences show as findings with a one-click fix; quantities the export doesn't show as numbers are flagged rather than treated as matching.
- Sign-in: after several wrong passwords, sign-in pauses for 15 minutes for that email. "Forgot your password?" on the sign-in page explains how to get a reset link from an owner or manager instead of waiting. Walkthroughs: under Tools in the sidebar, or the "?" at the top right.

Many actions depend on the person's role; if a page or button is missing for them, an owner or manager can change their role under Settings → Team.`;
