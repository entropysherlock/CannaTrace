# Create Without Leaving

**Goal:** an employee can finish a normal Leaf2Sale job without leaving the page just to create a missing prerequisite.

## The pattern

`<CreatableSelect>` (`src/components/contextual-create.tsx`) is a dropdown with a **+ Add …** button beside it.

1. The button opens a modal dialog. On phones the dialog is a bottom sheet. It is drawn outside the parent form, so the two forms are never nested and the parent's fields are never reset.
2. The dialog shows the record's own fields: the same shared component its home page uses (for example `StrainFields`).
3. Saving calls a small server action that returns `CreateResult` (`src/lib/contextual-create.ts`):
   - `created`: the dialog closes, the new record is added to the dropdown and selected, and focus returns to the dropdown.
   - `existing`: a record with the same name (ignoring case and spacing) is already there. Nothing is created. The dialog offers **Use …**, which selects the existing record.
   - `error`: the message is shown inside the dialog. Nothing is saved, and both forms keep what was typed.
4. **Cancel**, **×** or **Esc** closes the dialog without saving. The parent form is unchanged, and focus returns to the **+ Add** button.
5. When the user lacks the permission to create the record, the button is hidden and a hint says who can add it. The server action also checks the same permission as the record's own page, so hiding the button is never the only guard.

### Rules for every quick-create action

- Call the **same library function** as the record's own page. That function owns validation, licensing and compliance checks, and the audit log entry. Never write a second insert.
- Call `requirePermission(...)` with the **same permission** as the record's own page.
- Look for a same-name record first, and return `existing` instead of creating another.
- Ask for **every field the business rules require**. If the record has too many fields to fit, use a guided drawer (a multi-step `CreateDialog`) rather than dropping required fields.
- Call `revalidatePath` for the pages that list the record.

## Audit: where employees had to leave their task

Legend: ✅ done in this change · ⏭ next · 🧭 needs a guided drawer (complex record)

| Module | Task (page) | Missing prerequisite | Today | Create permission | Reuse | Status |
|---|---|---|---|---|---|---|
| Cultivation | Start a batch (`/cultivation`) | Strain | Form hidden; "add a strain on the Strains tab" | `cultivation.write` | `createStrain` | ✅ |
| Cultivation | Start a batch | Room | Leave for Settings → Facilities | `settings.manage` | `addRoom` | ✅ |
| Cultivation | Tag plants (batch page) | Room | Leave for Settings | `settings.manage` | `addRoom` | ✅ |
| Cultivation | Move plants / harvest (plants page) | Room / dry room | Leave for Settings | `settings.manage` | `addRoom` | ✅ |
| Cultivation | Package a harvest (harvest page) | Item counted by weight; location | "Add an item … on the Items page first" | `catalog.manage` | `quickAddItem` (weight units only, checked on the server); `createLocation` | ✅ |
| Inventory | Receive (`/inventory/receive`) | Item | Leave for Catalog | `catalog.manage` | `quickAddItem` | ✅ |
| Inventory | Receive / receive shipment | Vendor | Leave for Distribution → Vendors | `sales.write` | `createCustomer` (vendors are customer records); matched on license number | ✅ guided drawer |
| Inventory | Receive / receive shipment | Location | Leave for Locations | `catalog.manage` | `createLocation` (moved into the library; the Locations page uses it too) | ✅ |
| Catalog | Add item | Category | "Add a category first" | `catalog.manage` | `createCategory` (moved into the library) | ✅ |
| Manufacturing | Recipe form | Input/output item | Had its own inline box | `manufacturing.write` or `catalog.manage` | `quickAddItem` | ✅ moved onto `CreatableSelect` |
| Manufacturing | Start a production run | Recipe (and any item it needs, in a dialog on top) | Leave for Recipes tab | `manufacturing.write` | `createRecipe` | ✅ guided drawer |
| Distribution | New order (`/distribution`) | New vendor, or a new destination for an existing one | "Add a customer, then start an order" | `sales.write` | `createCustomer`, `createDestination`; optional license check via `verifyCustomerLicense` / `verifyDestinationLicense` | ✅ guided drawer |
| Distribution | Order → ship | Driver; vehicle | "Add a driver and a vehicle first" | `sales.write` | `createDriver`, `createVehicle` (now return the new id); matched on license number / plate | ✅ |
| Distribution | Order → add line | Item | Leave for Catalog | `catalog.manage` | `quickAddItem` | ✅ |
| Register | Menu (`/pos/menu`) | Item | Leave for Catalog | `pos.manage` + `catalog.manage` | `quickAddItem` | ✅ |
| SmartLabel | Print station | Label template | "No template for this label type yet" | `labels.manage` | `createTemplate` (copy), `setTemplateArchived` (bring back); a new design opens the designer in a new tab | ✅ |
| SmartLabel | Print station | Printer preset | Leave for Printers | `labels.manage` | `savePrinter` | ✅ |

Pickers that only choose among existing records and should **not** get a create button: plants, packages, batches, harvests, allocations, order lines, and anything whose creation is itself a compliance event.

## Where the pieces live

- `src/components/contextual-create.tsx`: `CreatableSelect`, `CreateConfig` and the dialog.
- `src/app/(app)/quick-create-actions.ts`: the shared quick-create actions for room, location, item, driver and vehicle. Strain is in `cultivation/actions.ts`.
- `src/components/quick-fields.tsx` (room, location, driver, vehicle) and `src/components/item-fields.tsx` (item; safe in client components): the dialog fields, named like each record's own page.

## Rollout order

1. ✅ Cultivation → Start a batch (strain and room): proves the pattern.
2. ✅ Rooms and locations everywhere they are picked (batch tag, plant move and harvest, harvest packaging, receive, receive shipment).
3. ✅ Items: receive, harvest packaging, order lines, register menu, and the recipe form (its own inline box is gone).
4. ✅ Driver and vehicle on the order page. The "add a driver and a vehicle first" dead end is gone.
5. ✅ Guided drawers: vendor while receiving, ship-to (new vendor or new destination) on a new order, recipe on a production run. Plus category on the Catalog page, and template and printer preset at the SmartLabel print station.

## Guided drawers

A `CreateConfig` with `steps` opens as a side drawer (a bottom sheet on phones) that asks for a record a step at a time:
- **Next** checks the current step's required boxes first. Enter on an early step moves on rather than saving.
- **Back** keeps everything typed. All steps' answers are sent together at the end.
- A dialog can open on top of the drawer (for example **+ Add item** inside **+ Add recipe**). Each closes back to the one beneath it.
- **License check step:** the license is never verified silently. The last step offers an explicit, unticked "I looked this license up on the state's license search today" box. Ticking it calls the same verification function as the vendor page, logged the same way. An already-expired license can't be ticked. Left unticked, the vendor or destination starts unverified, and orders to it can't be confirmed or shipped until someone verifies it, exactly as before.
- **Confirm before changing related records:** a server action can answer `confirm` instead of saving. For example, a license already on file belongs to a vendor not yet marked "we buy from". The drawer shows the question, and only a press of its button sends the form again with `confirm=1`.

The SmartLabel template designer stays a full page. When there's nothing to copy, **Design one in a new tab** opens it, so the print station keeps the chosen records.

## Tests

Guided drawers: vendor while receiving (step checks, Back keeps answers, saved unverified), an existing license offered with a yes-first "we buy from" change, inventory staff told who adds vendors, a new order shipping to a new vendor (ticked as checked) or a new location of an existing one (left unverified, and the order says so), an expired license refused for the check, a recipe with a brand-new output item added in a dialog on top of the drawer, a category while adding an item, a template copy and printer preset at the print station (records stay chosen), print-only staff with no add buttons, and the drawer as a phone bottom sheet. `tests/quick-create.test.ts` covers the library pieces.

Also exercised: tagging plants into a new room, moving ticked plants into a new room (the ticks stay), packaging a harvest (weight units only, and an existing "each" item can't be used), receiving with a new item and location, receiving a shipment with a new location, an order line with a new item (sales staff without catalog rights see who to ask), a register menu item, the recipe form (`manufacturing.spec.ts`), and a new driver and vehicle on the Ship step (`distribution.spec.ts`).


`e2e/create-without-leaving.spec.ts` covers each of these:
- creating, with the record selected and every other field kept
- cancelling with Esc and with the button (nothing saved, focus returned)
- duplicates offered rather than created (different case and spacing)
- server validation errors inside the dialog
- role limits (cultivation can add strains but not rooms; read-only staff can add neither)
- keyboard-only use (Enter saves the strain without starting the batch)
- a phone viewport (sheet fits the screen, tap works, no sideways scrolling)

`tests/cultivation-engine.test.ts` covers rejecting a strain name that differs only in letter case or spacing.
