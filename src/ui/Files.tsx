import * as DocumentPicker from 'expo-document-picker';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PickedFile } from '../data/repository';
import { friendlyError } from '../model/errors';
import type { Attachment } from '../model/types';
import { Button, Muted, Row } from './primitives';
import { radius, space, type, type Palette } from './theme';
import { useStyles } from './ThemeContext';

export const ACCEPTED_TYPES = ['image/*', 'application/pdf'];
const MAX_BYTES = 25 * 1024 * 1024; // matches the ic-files bucket limit

export const isImage = (mimeType: string) => mimeType.startsWith('image/');

/**
 * Open the phone's or computer's file picker. On a phone's browser this offers the camera, the
 * photo library and files; in the app, the system document picker. Returns [] if cancelled.
 */
export async function pickFiles(kind: 'photo' | 'any' = 'any'): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: kind === 'photo' ? 'image/*' : ACCEPTED_TYPES,
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    name: a.name,
    mimeType: a.mimeType ?? guessType(a.name),
    size: a.size,
    uri: a.uri,
    file: a.file,
  }));
}

/** Refuse what the bucket would refuse, before the upload rather than after. */
export function checkFile(f: PickedFile): string | undefined {
  if (!isImage(f.mimeType) && f.mimeType !== 'application/pdf')
    return `${f.name}: only photos and PDFs can be attached.`;
  if (f.size !== undefined && f.size > MAX_BYTES) return `${f.name} is over 25 MB.`;
  return undefined;
}

function guessType(name: string) {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'heic' || ext === 'heif') return `image/${ext}`;
  if (ext === 'webp' || ext === 'gif') return `image/${ext}`;
  return 'image/jpeg';
}

/** Turns a stored path into an address the screen can show. Provided once per project screen. */
const FileUrlContext = createContext<(path: string) => Promise<string>>(async (p) => p);
export const FileUrlProvider = FileUrlContext.Provider;

function useFileUrl(path: string) {
  const resolve = useContext(FileUrlContext);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    // The sample's placeholder photos have nothing behind them.
    if (path.startsWith('sample://')) return;
    resolve(path)
      .then((u) => live && setUrl(u))
      .catch((e: unknown) => live && setError(friendlyError(e, 'Could not open this file.')));
    return () => {
      live = false;
    };
  }, [path, resolve]);
  return { url, error };
}

/** One photo, full width, tap to open the original. */
export function PhotoView({ path, caption }: { path: string; caption?: string }) {
  const styles = useStyles(makeStyles);
  const { url, error } = useFileUrl(path);
  if (path.startsWith('sample://')) return <View style={styles.placeholder} />;
  if (error) return <Muted>{error}</Muted>;
  if (!url) return <View style={styles.placeholder} />;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={caption ? `Photo: ${caption}. Open full size` : 'Open photo full size'}
      onPress={() => void Linking.openURL(url)}
    >
      <Image source={{ uri: url }} style={styles.photo} resizeMode="contain" />
    </Pressable>
  );
}

function FileLink({ file }: { file: Attachment }) {
  const { url, error } = useFileUrl(file.path);
  return (
    <Button
      title={error ? `${file.name} — cannot open` : file.name}
      glyph={file.mimeType === 'application/pdf' ? '⎙' : '▧'}
      kind="secondary"
      disabled={!url}
      onPress={() => url && void Linking.openURL(url)}
    />
  );
}

/** The files on an entry: photos shown, PDFs as buttons that open them. */
export function AttachmentList({ files }: { files: Attachment[] }) {
  if (files.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      {files
        .filter((f) => isImage(f.mimeType))
        .map((f) => (
          <PhotoView key={f.path} path={f.path} caption={f.name} />
        ))}
      <Row wrap>
        {files
          .filter((f) => !isImage(f.mimeType))
          .map((f) => (
            <FileLink key={f.path} file={f} />
          ))}
      </Row>
    </View>
  );
}

/** Picked-but-not-yet-sent files, with a way to take one back out. */
export function PendingFiles({
  files,
  onRemove,
}: {
  files: PickedFile[];
  onRemove: (index: number) => void;
}) {
  const styles = useStyles(makeStyles);
  if (files.length === 0) return null;
  return (
    <Row wrap>
      {files.map((f, i) => (
        <Pressable
          key={`${f.uri}:${i}`}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${f.name}`}
          onPress={() => onRemove(i)}
          style={styles.pending}
        >
          <Text style={styles.pendingText}>
            {isImage(f.mimeType) ? '▧' : '⎙'} {f.name} ✕
          </Text>
        </Pressable>
      ))}
    </Row>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    photo: {
      width: '100%',
      aspectRatio: 4 / 3,
      maxHeight: 420,
      borderRadius: radius.md,
      backgroundColor: p.panelAlt,
    },
    placeholder: {
      width: '100%',
      aspectRatio: 4 / 3,
      maxHeight: 240,
      borderRadius: radius.md,
      backgroundColor: p.panelAlt,
    },
    pending: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: p.panelAlt,
      borderWidth: 1,
      borderColor: p.line,
    },
    pendingText: { ...type.small, color: p.ink2 },
  });
