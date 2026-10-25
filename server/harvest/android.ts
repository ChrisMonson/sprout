// Finds the Android tools on this Mac (SDK, adb, emulator, a JDK Gradle accepts)
// and talks to phones and emulators through adb.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface AndroidTools {
  sdk: string;
  adb: string;
  emulator: string | null;
  javaHome: string;
}

export interface Device {
  serial: string;
  /** e.g. "Pixel 9 Pro" or "Pixel_9_Pro_16KB (emulator)" */
  label: string;
  /** adb sees it but it can't be used yet: "unauthorized" or "offline" */
  problem: string | null;
}

let cached: AndroidTools | null = null;

async function findJavaHome(): Promise<string | null> {
  const candidates = [
    process.env.JAVA_HOME,
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  ];
  for (const home of candidates) if (home && existsSync(join(home, 'bin', 'java'))) return home;
  for (const version of ['21', '17']) {
    try {
      const { stdout } = await run('/usr/libexec/java_home', ['-v', version]);
      if (stdout.trim()) return stdout.trim();
    } catch { /* not installed */ }
  }
  return null;
}

/** The tools, or an explanation of what's missing. */
export async function androidTools(): Promise<AndroidTools | { missing: string }> {
  if (cached) return cached;
  const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library', 'Android', 'sdk')]
    .find(dir => dir && existsSync(join(dir, 'platform-tools', 'adb')));
  if (!sdk) return { missing: 'Sprout couldn’t find the Android SDK. Install Android Studio, open it once so it downloads the SDK, then try again.' };
  const javaHome = await findJavaHome();
  if (!javaHome) return { missing: 'Sprout couldn’t find Java 17 or newer. Android Studio includes one; install it and try again.' };
  const emulator = join(sdk, 'emulator', 'emulator');
  cached = { sdk, adb: join(sdk, 'platform-tools', 'adb'), emulator: existsSync(emulator) ? emulator : null, javaHome };
  return cached;
}

export async function listDevices(tools: AndroidTools): Promise<Device[]> {
  const { stdout } = await run(tools.adb, ['devices', '-l']);
  const devices: Device[] = [];
  for (const line of stdout.split('\n').slice(1)) {
    const [serial, state, ...rest] = line.trim().split(/\s+/);
    if (!serial || !state) continue;
    const info = Object.fromEntries(rest.map(part => part.split(':')).filter(p => p.length === 2));
    let label = (info.model ?? serial).replace(/_/g, ' ');
    if (serial.startsWith('emulator-')) {
      label = await emulatorName(tools, serial).catch(() => label);
      label = `${label} (emulator)`;
    }
    const problem = state === 'device' ? null
      : state === 'unauthorized' ? 'Unlock the phone and allow USB debugging for this Mac.'
      : `It’s ${state}. Reconnect it and try again.`;
    devices.push({ serial, label, problem });
  }
  return devices;
}

async function emulatorName(tools: AndroidTools, serial: string): Promise<string> {
  const { stdout } = await run(tools.adb, ['-s', serial, 'emu', 'avd', 'name']);
  return stdout.split('\n')[0].trim().replace(/_/g, ' ') || serial;
}

/** Emulators set up in Android Studio. */
export function listEmulators(): string[] {
  const dir = join(homedir(), '.android', 'avd');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.ini')).map(f => f.slice(0, -4)).sort();
}

/** Starts an emulator in the background; it shows up in listDevices once booted. */
export function startEmulator(tools: AndroidTools, name: string) {
  if (!tools.emulator) throw new Error('The Android emulator isn’t installed. Add it from Android Studio’s SDK Manager.');
  if (!listEmulators().includes(name)) throw new Error(`There’s no emulator called ${name}.`);
  const child = spawn(tools.emulator, ['-avd', name], { detached: true, stdio: 'ignore' });
  child.unref();
}

export function androidEnv(tools: AndroidTools): Record<string, string> {
  return { ANDROID_HOME: tools.sdk, ANDROID_SDK_ROOT: tools.sdk, JAVA_HOME: tools.javaHome };
}

export async function install(tools: AndroidTools, serial: string, apk: string, appId: string) {
  await run(tools.adb, ['-s', serial, 'install', '-r', apk], { maxBuffer: 8 * 1024 * 1024 });
  await run(tools.adb, ['-s', serial, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
}
