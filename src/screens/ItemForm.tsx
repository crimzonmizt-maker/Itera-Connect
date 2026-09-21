import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ItemInput } from '../data/repository';
import { addDays, moneyInput, parseMoney, shortDate } from '../model/format';
import type { Item, ItemStatus, Project, ProjectMember, Purchaser, Room } from '../model/types';
import {
  modeDefaults,
  priceVisibleToHomeowner,
  sourcingVisibleToHomeowner,
} from '../model/visibility';
import { Button, Card, Choice, Field, Muted, Row } from '../ui/primitives';
import { space, type, type Palette } from '../ui/theme';
import { useStyles, useTheme } from '../ui/ThemeContext';

type Tri = 'default' | 'yes' | 'no';
const triToBool = (t: Tri): boolean | undefined => (t === 'default' ? undefined : t === 'yes');
const boolToTri = (b: boolean | undefined): Tri => (b === undefined ? 'default' : b ? 'yes' : 'no');

const STATUSES: ItemStatus[] = [
  'proposed',
  'changes_requested',
  'approved',
  'ordered',
  'delivered',
  'installed',
];

/**
 * What the contractor's save produces. Besides the item, a status change to ordered or
 * delivered is an EVENT — that is how the expected date and the box count get on the record,
 * which is what the concierge and the item card read.
 */
export type ItemSave = {
  item: ItemInput;
  /** The contractor typed a room that does not exist yet; create it, then put the item in it. */
  newRoom?: { name: string };
  order?: { expectedDate: string };
  delivery?: { expected: number; received: number; damaged: number };
};
const UNITS = ['each', 'box', 'bag', 'sq ft', 'lin ft', 'sheet', 'gal'];

/**
 * Add or edit one item. The contractor fills in everything; the form shows, live, exactly
 * what the homeowner will end up seeing — so "did I just share the SKU?" is answered before
 * Save, not after.
 */
export function ItemForm({
  project,
  members,
  rooms,
  initial,
  onSave,
  onCancel,
}: {
  project: Project;
  members: ProjectMember[];
  rooms: Room[];
  initial?: Item;
  onSave: (save: ItemSave) => Promise<void>;
  onCancel: () => void;
}) {
  const { palette: p, tones } = useTheme();
  const styles = useStyles(makeStyles);
  const defaults = modeDefaults(project.mode);
  const [name, setName] = useState(initial?.name ?? '');
  // 'new' = the contractor is naming a room that is not on the project yet.
  const [roomId, setRoomId] = useState<string>(
    initial?.roomId ?? (rooms.length === 0 ? 'new' : (rooms[0]?.id ?? 'new')),
  );
  const [newRoomName, setNewRoomName] = useState('');
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [unit, setUnit] = useState(initial?.unit ?? 'each');
  const [status, setStatus] = useState<ItemStatus>(initial?.status ?? 'proposed');
  // Only asked when the status is moving INTO ordered / delivered on this save.
  const [arriveDays, setArriveDays] = useState(
    initial?.sourcing?.leadTimeDays !== undefined ? String(initial.sourcing.leadTimeDays) : '14',
  );
  const [received, setReceived] = useState(String(initial?.quantity ?? 1));
  const [damaged, setDamaged] = useState('0');
  const becomingOrdered = status === 'ordered' && initial?.status !== 'ordered';
  const becomingDelivered = status === 'delivered' && initial?.status !== 'delivered';
  const [purchasedBy, setPurchasedBy] = useState<Purchaser>(
    initial?.purchasedBy ?? defaults.purchasedBy,
  );
  const [price, setPrice] = useState(moneyInput(initial?.clientPrice));
  const [sharePrice, setSharePrice] = useState<Tri>(boolToTri(initial?.sharePrice));
  const [shareSourcing, setShareSourcing] = useState<Tri>(boolToTri(initial?.shareSourcing));
  const [supplier, setSupplier] = useState(initial?.sourcing?.supplier ?? '');
  const [sku, setSku] = useState(initial?.sourcing?.sku ?? '');
  const [orderNumber, setOrderNumber] = useState(initial?.sourcing?.orderNumber ?? '');
  const [leadTime, setLeadTime] = useState(
    initial?.sourcing?.leadTimeDays !== undefined ? String(initial.sourcing.leadTimeDays) : '',
  );
  const [supplierCost, setSupplierCost] = useState(moneyInput(initial?.team?.supplierCost));
  const [note, setNote] = useState(initial?.team?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const priceCents = parseMoney(price);
  const priceBad = price.trim() !== '' && priceCents === undefined;
  const costCents = parseMoney(supplierCost);
  const costBad = supplierCost.trim() !== '' && costCents === undefined;
  const qty = Number(quantity);
  const qtyBad = quantity.trim() === '' || Number.isNaN(qty) || qty < 0;
  const lead = leadTime.trim() === '' ? undefined : Number(leadTime);
  const leadBad = lead !== undefined && (Number.isNaN(lead) || lead < 0);
  const arriveBad = becomingOrdered && (Number.isNaN(Number(arriveDays)) || Number(arriveDays) < 0);
  const recNum = Number(received);
  const damNum = Number(damaged);
  const deliveryBad =
    becomingDelivered &&
    (Number.isNaN(recNum) || Number.isNaN(damNum) || recNum < 0 || damNum < 0 || damNum > recNum);
  const roomBad = roomId === 'new' && newRoomName.trim() === '';
  const valid =
    name.trim().length > 0 &&
    !roomBad &&
    !priceBad &&
    !costBad &&
    !qtyBad &&
    !leadBad &&
    !arriveBad &&
    !deliveryBad;

  const build = (): ItemInput => {
    const sourcing = {
      supplier: supplier.trim() || undefined,
      sku: sku.trim() || undefined,
      orderNumber: orderNumber.trim() || undefined,
      leadTimeDays: lead,
    };
    const team = { supplierCost: costCents, note: note.trim() || undefined };
    const item: ItemInput = {
      id: initial?.id,
      name: name.trim(),
      roomId: roomId === 'new' || roomId === '' ? undefined : roomId,
      quantity: qty,
      unit: unit.trim() || undefined,
      status,
      purchasedBy,
      clientPrice: priceCents,
      sharePrice: triToBool(sharePrice),
      shareSourcing: triToBool(shareSourcing),
    };
    if (Object.values(sourcing).some((v) => v !== undefined)) item.sourcing = sourcing;
    if (Object.values(team).some((v) => v !== undefined)) item.team = team;
    return item;
  };

  // What the homeowner will see, computed with the same rules the repository uses.
  const preview = build();
  const asItem: Item = {
    ...preview,
    id: preview.id ?? 'preview',
    projectId: project.id,
  };
  const showsPrice = priceVisibleToHomeowner(project, asItem) && priceCents !== undefined;
  const showsSourcing = sourcingVisibleToHomeowner(asItem) && asItem.sourcing !== undefined;
  const homeowners = members.filter((m) => m.role === 'homeowner');
  const who =
    homeowners.length === 0
      ? 'The homeowner'
      : homeowners.map((h) => h.displayName.split(' ')[0]).join(' and ');
  const seen = [
    'name, quantity, status, who buys it',
    showsPrice ? 'the price' : undefined,
    showsSourcing ? 'supplier, SKU, order # and lead time' : undefined,
  ].filter(Boolean);
  const hidden = [
    !showsPrice && priceCents !== undefined ? 'the price' : undefined,
    !showsSourcing && asItem.sourcing ? 'supplier and SKU' : undefined,
    asItem.team ? 'your cost and private note' : undefined,
  ].filter(Boolean);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSave({
        item: build(),
        newRoom: roomId === 'new' ? { name: newRoomName.trim() } : undefined,
        order: becomingOrdered
          ? {
              expectedDate: addDays(new Date().toISOString(), Number(arriveDays) || 0),
            }
          : undefined,
        delivery: becomingDelivered
          ? { expected: qty, received: recNum, damaged: damNum }
          : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the item.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <Text style={styles.title}>{initial ? 'Edit item' : 'Add an item'}</Text>

      <Field
        label="Item"
        value={name}
        onChangeText={setName}
        placeholder='e.g. Cape Breton 48" vanity, white oak'
        autoFocus
      />
      <Choice
        label="Room"
        options={[
          ...rooms.map((r) => ({ value: r.id, label: r.name })),
          { value: 'new', label: 'New room…', glyph: '+' },
          { value: '', label: 'No room' },
        ]}
        value={roomId}
        onChange={setRoomId}
        hint="Rooms group the selections and, later, the tasks. A permit or a dumpster has no room."
      />
      {roomId === 'new' ? (
        <View style={{ maxWidth: 320 }}>
          <Field
            label="New room"
            value={newRoomName}
            onChangeText={setNewRoomName}
            placeholder="e.g. Jack and Jill upstairs"
            autoFocus
          />
        </View>
      ) : null}
      <Row wrap style={{ gap: space.md, alignItems: 'flex-start' }}>
        <View style={{ width: 90 }}>
          <Field
            label="Quantity"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
          />
        </View>
      </Row>
      <Choice
        label="Unit"
        options={UNITS.map((u) => ({ value: u, label: u }))}
        value={UNITS.includes(unit) ? unit : undefined}
        onChange={setUnit}
      />
      <Choice
        label="Status"
        options={STATUSES.map((s) => ({
          value: s,
          label: tones.itemStatus[s].label,
          glyph: tones.itemStatus[s].glyph,
        }))}
        value={status}
        onChange={setStatus}
        hint={
          status === 'changes_requested'
            ? 'The homeowner asked for a change. Revise, then use "Ask again" on the item.'
            : undefined
        }
      />
      {becomingOrdered ? (
        <View style={styles.eventBox}>
          <Text style={styles.blockLabel}>⇢ This will post an “Ordered” entry</Text>
          <View style={{ width: 200 }}>
            <Field
              label="Expected to arrive in (days)"
              value={arriveDays}
              onChangeText={setArriveDays}
              keyboardType="number-pad"
            />
          </View>
          <Muted>
            Expected {shortDate(addDays(new Date().toISOString(), Number(arriveDays) || 0))}. The
            concierge checks this against the jobs that need it.
          </Muted>
          {arriveBad ? <Text style={styles.error}>Enter a number of days.</Text> : null}
        </View>
      ) : null}
      {becomingDelivered ? (
        <View style={styles.eventBox}>
          <Text style={styles.blockLabel}>▣ This will post a “Delivery” entry</Text>
          <Row wrap style={{ gap: space.md, alignItems: 'flex-start' }}>
            <View style={{ width: 140 }}>
              <Field
                label={`Received (of ${quantity || '?'})`}
                value={received}
                onChangeText={setReceived}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ width: 140 }}>
              <Field
                label="Damaged"
                value={damaged}
                onChangeText={setDamaged}
                keyboardType="number-pad"
              />
            </View>
          </Row>
          <Muted>
            Count what actually came off the truck. Short or damaged, and the concierge follows it
            up until it is made whole.
          </Muted>
          {deliveryBad ? (
            <Text style={styles.error}>
              Counts must be whole numbers; damaged cannot exceed received.
            </Text>
          ) : null}
        </View>
      ) : null}

      <Choice
        label="Who buys it"
        options={[
          {
            value: 'contractor' as Purchaser,
            label: 'I supply it',
            glyph: '⚒',
          },
          {
            value: 'homeowner' as Purchaser,
            label: `${who} ${homeowners.length > 1 ? 'buy' : 'buys'} it`,
            glyph: '⌂',
          },
        ]}
        value={purchasedBy}
        onChange={setPurchasedBy}
        hint={
          purchasedBy === 'homeowner'
            ? `${who} will see the supplier and SKU below so they can go and order it.`
            : `Project default for a ${project.mode.replace('_', '-')} job: ${defaults.purchasedBy === 'contractor' ? 'you supply' : 'homeowner buys'}.`
        }
      />

      <Field
        label="Client price ($) — leave blank if it is simply in the contract"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="1840.00"
      />
      {priceBad ? <Text style={styles.error}>Enter dollars and cents, like 1840.00</Text> : null}

      {purchasedBy === 'contractor' ? (
        <>
          <Choice
            label={`Show the price to ${who}`}
            options={[
              {
                value: 'default' as Tri,
                label: `Project default (${project.showPrices ? 'shown' : 'hidden'})`,
              },
              { value: 'yes' as Tri, label: 'Show' },
              { value: 'no' as Tri, label: 'Hide' },
            ]}
            value={sharePrice}
            onChange={setSharePrice}
          />
          <Choice
            label={`Show supplier and SKU to ${who}`}
            options={[
              { value: 'default' as Tri, label: 'Project default (hidden)' },
              { value: 'yes' as Tri, label: 'Show' },
              { value: 'no' as Tri, label: 'Hide' },
            ]}
            value={shareSourcing}
            onChange={setShareSourcing}
          />
        </>
      ) : null}

      <View style={styles.sourcing}>
        <Text style={styles.blockLabel}>
          ⇢ Sourcing —{' '}
          {showsSourcing ? `${who} will see this` : 'your business only, unless shared above'}
        </Text>
        <Row wrap style={{ gap: space.md, alignItems: 'flex-start' }}>
          <View style={{ flexGrow: 1, minWidth: 160 }}>
            <Field
              label="Supplier"
              value={supplier}
              onChangeText={setSupplier}
              placeholder="Northline Cabinetry"
            />
          </View>
          <View style={{ flexGrow: 1, minWidth: 120 }}>
            <Field
              label="SKU / part #"
              value={sku}
              onChangeText={setSku}
              placeholder="CB-48-WO"
              autoCapitalize="characters"
            />
          </View>
        </Row>
        <Row wrap style={{ gap: space.md, alignItems: 'flex-start' }}>
          <View style={{ flexGrow: 1, minWidth: 120 }}>
            <Field
              label="Order #"
              value={orderNumber}
              onChangeText={setOrderNumber}
              placeholder="once ordered"
            />
          </View>
          <View style={{ width: 130 }}>
            <Field
              label="Lead time (days)"
              value={leadTime}
              onChangeText={setLeadTime}
              keyboardType="number-pad"
              placeholder="42"
            />
          </View>
        </Row>
        {leadBad ? <Text style={styles.error}>Lead time is a number of days.</Text> : null}
      </View>

      <View style={styles.team}>
        <Text style={[styles.blockLabel, { color: p.amber }]}>
          ◈ Your business only — never shown to the homeowner
        </Text>
        <Field
          label="Your cost ($)"
          value={supplierCost}
          onChangeText={setSupplierCost}
          keyboardType="decimal-pad"
          placeholder="1265.00"
        />
        {costBad ? <Text style={styles.error}>Enter dollars and cents, like 1265.00</Text> : null}
        <Field
          label="Private note"
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="e.g. Client dislikes brushed nickel — confirm pulls are matte black."
        />
      </View>

      <View style={styles.preview} accessibilityLabel="What the homeowner will see">
        <Text style={styles.blockLabel}>◎ {who} will see</Text>
        <Text style={styles.previewText}>{seen.join(', ')}.</Text>
        {hidden.length ? (
          <Text style={styles.previewText}>Not shown: {hidden.join('; ')}.</Text>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>▲ {error}</Text> : null}
      <Row wrap style={{ justifyContent: 'flex-end' }}>
        <Button title="Cancel" kind="quiet" onPress={onCancel} />
        <Button
          title={initial ? 'Save changes' : 'Add item'}
          glyph="✓"
          onPress={save}
          disabled={busy || !valid}
        />
      </Row>
      {!valid && name.trim().length === 0 ? <Muted>Give the item a name to save it.</Muted> : null}
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    title: { ...type.h2, color: p.ink },
    blockLabel: { ...type.label, color: p.ink2 },
    sourcing: {
      backgroundColor: p.slateSoft,
      borderRadius: 8,
      padding: space.md,
      gap: space.sm,
    },
    team: {
      backgroundColor: p.amberSoft,
      borderRadius: 8,
      padding: space.md,
      gap: space.sm,
    },
    eventBox: {
      backgroundColor: p.accentSoft,
      borderRadius: 8,
      padding: space.md,
      gap: space.sm,
    },
    preview: {
      backgroundColor: p.tealSoft,
      borderRadius: 8,
      padding: space.md,
      gap: 4,
    },
    previewText: { ...type.small, color: p.ink },
    error: { ...type.small, color: p.amber, fontWeight: '600' },
  });
