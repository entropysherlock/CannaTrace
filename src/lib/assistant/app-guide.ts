/**
 * Where things are in CannaTrace and how common jobs are done, so Tally can answer "how do I…?"
 * questions with real steps. Keep this in step with the sidebar (src/app/(app)/layout.tsx) and the
 * page and card titles it names. It describes the screens; Tally still uses tools for live data.
 */
export const APP_GUIDE = `CannaTrace app guide (the sidebar on the left, tabs across the top of each page; names below are exactly what's on screen):

Dashboard: today's numbers, Tally Watch findings, sales by day, what needs attention. Quick buttons: New sale, Receive, Count, Orders, Plants.

Cultivation (tabs: Overview, Plants, Harvests, Strains)
- Add a strain: Cultivation → Strains → "Add a strain".
- Start a batch of clones or seeds: Cultivation → Overview → "Start a batch" (name, strain, clones or seeds, how many, room).
- Tag plants: open the batch from "Plant batches" on Overview → "Tag plants" (scan or type tags, or a first tag and a count). "Record lost plants" is on the same page.
- Change phase, move, harvest, or destroy plants: Cultivation → Plants → tick plants ("Tick or untick all" for everything shown) → "Choose what to do" → "Apply to ticked plants". Filter by phase, room, or strain first.
- A harvest: Cultivation → Harvests → open it → "Record dry weight", "Log waste", "Package from this harvest", then "Finish harvest" once every gram is packaged or logged.
- Tasks: Cultivation → Overview → "Add a task"; press Done on "Open tasks" when finished.

Inventory (tabs: Packages, Receive, Counts, Items, Locations)
- Find a package: Inventory → Packages, search by tag, item, or lot, filter by status. Open it to see its history and lab results.
- On a package page: "Move", "Adjust quantity", "Split into new packages", "Merge with other packages", "Hold, quarantine, or destroy", "Add lab result" (with a section for the full cannabinoid profile and terpenes), "Print package label", "Print product label".
- Receive new packages: Inventory → Receive. Leave the tag blank and CannaTrace makes a new unique ID (PKG-000123); the same goes for splits, merges, harvest packages, and production runs. Leave the SKU blank on "Add an item" to get one like FLO-0007; change it under "Name and SKU" on the item.
- Count a room or shelf: Inventory → Counts → "Count a location".
- Products: Inventory → Items → "Add an item" or "Add a category". "Label details" on each item holds unit weight, servings and mg per serving, shelf life, refrigeration, directions, ingredients, allergens, pesticides, and solvents for product labels.
- Racks and bins: Inventory → Locations → "Add a location".
- Rooms with an area type (Propagation, Vegetative, Flowering, Harvest, Drying & Trimming, Inventory, Quarantine, Waste): Settings → Facilities → the facility's card → "Add a room"; each room has Edit to rename it or change its area.

Manufacturing (tabs: Production runs, Recipes)
- Recipes → "New recipe" (output item and quantity, and what goes in).
- Production runs → "Start a run" → open it → "Add an input" (scan the package tags used) → "Complete the run" (new tag, actual quantity, room).

Distribution (tabs: Orders, Invoices, Vendors, Price lists, Drivers and vehicles)
- Vendors → "Add a vendor" (license number and expiry; verify the license before shipping). A vendor can have several destinations.
- Price lists → "New price list", "Set a price".
- Orders → "Start an order" → "Add a line" → "Confirm the order" → "Pick a package" for each line → "Mark packed" → "Ship" (driver, vehicle, times; makes the manifest) → "Mark delivered".
- Invoices → "Record a payment" or "Issue a credit memo".
- Drivers and vehicles → "Add a driver", "Add a vehicle".

Register (tabs: Register, Cash drawer, Menu and store rules)
- Before selling, a manager enters purchase limits and tax rates under Register → Menu and store rules ("Store rules"); the register stays locked until then. Menu prices: "Add or change a menu item". Discounts: "Add a discount".
- Cash drawer: open it at the start of a shift, "Close the drawer" at the end.
- A sale: Register → check the customer's ID (date of birth and expiry) → add items (search or scan) → take payment. Past sales open from the register; "Return items" and "Void this sale" are on the sale.

SmartLabel AI (tabs: Print, Templates, Printers, History)
- Print: choose the label type (Plant tag, Batch label, Package label, Product label, Transfer label) → template → tick records → "Check and preview" → print.
- Templates: edit or duplicate a design; "Insert a field" adds data such as net weight, lot, harvest batch, cannabinoid profile. New Mexico product labels need the state's cannabis logo uploaded once.
- Printers: save a printer and nudge the alignment; print a test label.

Show me how (SmartWorkflows): the "Show me how" button at the top right of the Dashboard opens guided walkthroughs that highlight each step, page to page, on the business's real data: Harvest to shelf, Start a grow, Make a product, Fill a wholesale order, Receive a delivery. When someone asks how to do one of those jobs, give the steps and mention they can press Show me how and pick it to be walked through. A link like /dashboard?walk=harvest-to-shelf starts one directly (ids: harvest-to-shelf, start-a-grow, make-a-product, fill-an-order, receive-delivery).
Reports (tabs: Reports, Import and export): inventory value and age, retail sales, wholesale, harvest and production yields. Import and export downloads spreadsheets (CSV) of packages, items, locations, customers, invoices, retail sales, and the audit trail, and uploads items, locations, customers, and opening inventory. "Switch from NMS2S", "Switch from Dutchie" and "Switch from Flourish" on the same page load an inventory list from those systems (NMS2S, New Mexico's state system: an Inventory Room's list with its column names, ID column formatted as Text so Excel keeps all 16 digits; Dutchie: Reports → Current Inventory; Flourish: Inventory → All Packages; Excel or CSV): products, rooms, and packages with their tags, batches, quantities, and costs. Press "Check the file" first; nothing is saved until "Import". THC and CBD come across as pending lab results to confirm.

Compliance (tabs: State reporting, State rules, Audit trail): the state track-and-trace system for this facility and what's waiting to send; the state's rules CannaTrace enforces and anything to fix; every change, who made it, and when.

Settings (tabs: Business, Facilities, Team, Integrations, Tally AI)
- Business: the business name.
- Facilities: add a facility, edit its license and state, switch facilities, add rooms, and (for owners) load a sample facility with practice data.
- Team: "Invite someone" (sends a one-time link), change roles, build custom roles, make a password reset link for a person.
- Integrations: API keys and webhooks.
- Tally AI: connect the business's Claude account and set limits.
- Switch facility: the menu at the top of every page. Change your own password: "Password" under your name at the bottom of the sidebar.

Many actions depend on the person's role; if a page or button is missing for them, an owner or manager can change their role under Settings → Team.`;
