# Create Without Leaving

**Goal:** an employee can finish a normal CannaTrace job without leaving the page just to create a missing prerequisite.

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
| Cultivation | Tag plants (batch page) | Room | Leave for Settings | `settings.manage` | `addRoom` | ⏭ |
| Cultivation | Move plants / harvest (plants page) | Room / dry room | Leave for Settings | `settings.manage` | `addRoom` | ⏭ |
| Cultivation | Package a harvest (harvest page) | Bulk item; location | "Add an item … on the Items page first" | `catalog.manage` | `quickAddItem`; `addLocation` | ⏭ |
| Inventory | Receive (`/inventory/receive`) | Item | Leave for Catalog | `catalog.manage` | `quickAddItem` | ⏭ |
| Inventory | Receive / receive shipment | Vendor | Leave for Distribution → Customers | `sales.write` | `createCustomer` (vendors are customer records) | 🧭 license fields |
| Inventory | Receive / receive shipment | Location | Leave for Locations | `catalog.manage` | `addLocation` → move to lib | ⏭ |
| Catalog | Add item | Category | "Add a category first" | `catalog.manage` | `addCategory` → move to lib | ⏭ |
| Manufacturing | Recipe form | Input/output item | Already inline (`NewItem`) | `manufacturing.write` | `quickAddItem` | ⏭ move onto `CreatableSelect` |
| Manufacturing | Start a production run | Recipe | Leave for Recipes tab | `manufacturing.write` | `createRecipe` | 🧭 inputs and outputs |
| Distribution | New order (`/distribution`) | Customer; destination | "Add a customer, then start an order" | `sales.write` | `createCustomer`, `createDestination` | 🧭 license verification |
| Distribution | Order → ship | Driver; vehicle | "Add a driver and a vehicle first" | `sales.write` | `createDriver`, `createVehicle` (must return the new id) | ⏭ |
| Distribution | Order → add line | Item | Leave for Catalog | `catalog.manage` | `quickAddItem` | ⏭ |
| Register | Menu (`/pos/menu`) | Item / menu entry; discount preset | Leave for Catalog | `pos.manage` (+ `catalog.manage` for new items) | `menuItemAction`, `discountPresetAction` | ⏭ |
| SmartLabel | Print station | Label template | "No template for this label type yet" | `labels.manage` | template service | 🧭 designer |
| SmartLabel | Print station | Printer preset | Leave for Printers | `labels.manage` | `savePrinterAction` → lib | ⏭ |

Pickers that only choose among existing records and should **not** get a create button: plants, packages, batches, harvests, allocations, order lines, and anything whose creation is itself a compliance event.

## Rollout order

1. ✅ Cultivation → Start a batch (strain and room): proves the pattern.
2. Rooms and locations everywhere they are picked (batch tag, plant move, harvest, receive). This is the same `QuickRoomFields` and the same action.
3. Items: receive, harvest packaging, order lines, and register menu. Move the recipe form's `NewItem` onto `CreatableSelect` so there is only one way.
4. Driver and vehicle on the order page.
5. Guided drawers: customer or vendor with license verification, destination, recipe, and label template.

## Tests

`e2e/create-without-leaving.spec.ts` covers each of these:
- creating, with the record selected and every other field kept
- cancelling with Esc and with the button (nothing saved, focus returned)
- duplicates offered rather than created (different case and spacing)
- server validation errors inside the dialog
- role limits (cultivation can add strains but not rooms; read-only staff can add neither)
- keyboard-only use (Enter saves the strain without starting the batch)
- a phone viewport (sheet fits the screen, tap works, no sideways scrolling)

`tests/cultivation-engine.test.ts` covers rejecting a strain name that differs only in letter case or spacing.
