# CannaTrace workflows → state functions

The "NMS2S function" column must be filled from the official specification. Until then each workflow is reported by hand (MANUAL in State reporting) or appears in reconciliation only.

| CannaTrace workflow | Engine function | Sync event | CannaTrace intent | NMS2S function | Automation today |
|---|---|---|---|---|---|
| Receive a package | `receivePackage` | `PACKAGE_RECEIVED` | — | _from spec_ | Manual |
| Adjust quantity (with reason) | `adjustPackage`, cycle count | `PACKAGE_ADJUSTED` | `PACKAGE_ADJUST` | _from spec_ | Ready (simulator only) |
| Split a package | `splitPackage` | `PACKAGE_CREATED_FROM_PACKAGES` (split) | `PACKAGE_SPLIT` | _from spec_ | Ready (simulator only) |
| Merge packages | `mergePackages` | `PACKAGE_CREATED_FROM_PACKAGES` (merge) | — | _from spec_ | Manual |
| Production run output | manufacturing | `PACKAGE_CREATED_FROM_PACKAGES` (run) | — | _from spec_ | Manual |
| Package from harvest | cultivation | `PACKAGE_CREATED_FROM_HARVEST` | — | _from spec_ | Manual |
| Move a package | `movePackage` | `PACKAGE_MOVED` | — | _from spec_ | Manual |
| Destroy a package | destroy flow | `PACKAGE_DESTROYED` | — | _from spec_ | Manual |
| Record a lab result | lab results | `LAB_RESULT_RECORDED` | — | _from spec_ | Manual |
| Create a plant batch, tag plants | cultivation | `PLANT_BATCH_CREATED`, `PLANTS_TAGGED` | — | _from spec_ | Manual |
| Change plant phase, move, destroy | cultivation | `PLANT_PHASE_CHANGED`, `PLANT_MOVED`, `PLANT_DESTROYED`, `PLANT_BATCH_PLANTS_DESTROYED` | — | _from spec_ | Manual |
| Harvest, waste, finish, reopen | cultivation | `HARVEST_*` | — | _from spec_ | Manual |
| Ship, deliver, receive a transfer | distribution | `TRANSFER_SHIPPED`, `TRANSFER_DELIVERED`, `TRANSFER_RECEIVED` | — | _from spec_ | Manual |
| Retail sale, void, return | POS | `RETAIL_SALE`, `RETAIL_SALE_VOIDED`, `RETAIL_SALE_RETURNED` | — | _from spec_ | Manual |
| Compare inventory with the state | Tally Watch (CSV) / `runReconciliation` | — | package and plant reads | _from spec_ | CSV upload today; API reads ready (simulator only) |

## To add an intent once the specification is in hand

1. Add the intent type to `WriteOperation` in `types.ts`.
2. Map the event in `sync-bridge.ts` (`toWriteOperation`), and add the event type to the adapter's `supported` list.
3. Implement it in `official-transport.ts`.
4. Teach the simulator the same intent, so the ledger and queue tests cover it.
5. Add a UAT test case to the evidence template.
