'use client';

import {
  LiveKitRoom,
  VideoConference,
  formatChatMessageLinks,
  useToken,
  LocalUserChoices,
  PreJoin,
} from '@livekit/components-react';
import {
  DeviceUnsupportedError,
  ExternalE2EEKeyProvider,
  Room,
  RoomConnectOptions,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  setLogLevel,
} from 'livekit-client';

import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { DebugMode } from '@/lib/Debug';
import { decodePassphrase, useServerUrl } from '@/lib/client-utils';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { validateVideoCodec } from '@/lib/validate';

export default function Page({ params }: { params: { roomName: string } }) {
  const router = useRouter();
  const roomName = params.roomName;
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const handlePreJoinSubmit = React.useCallback((values: LocalUserChoices) => {
    setPreJoinChoices(values);
  }, []);
  const onPreJoinError = React.useCallback((e: any) => {
    console.error(e);
  }, []);
  const onLeave = React.useCallback(() => router.push('/'), []);

  return (
    <main data-lk-theme="default">
      {roomName && !Array.isArray(roomName) && preJoinChoices ? (
        <ActiveRoom roomName={roomName} userChoices={preJoinChoices} onLeave={onLeave}></ActiveRoom>
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            onError={onPreJoinError}
            defaults={preJoinDefaults}
            onSubmit={handlePreJoinSubmit}
          />
        </div>
      )}
    </main>
  );
}

function ActiveRoom(props: {
  userChoices: LocalUserChoices;
  roomName: string;
  onLeave: () => void;
}) {
  const searchParams = useSearchParams();
  const region = searchParams?.get('region');
  const hq = searchParams?.get('hq');
  const codec = validateVideoCodec(searchParams?.get('codec'));

  const tokenOptions = React.useMemo(() => {
    return {
      userInfo: {
        identity: props.userChoices.username,
        name: props.userChoices.username,
      },
    };
  }, [props.userChoices.username]);
  const token = useToken(process.env.NEXT_PUBLIC_LK_TOKEN_ENDPOINT, props.roomName, tokenOptions);

  const e2eePassphrase =
    typeof window !== 'undefined' && decodePassphrase(location.hash.substring(1));

  const liveKitUrl = useServerUrl(typeof region === 'string' ? region : undefined);

  const worker =
    typeof window !== 'undefined' &&
    e2eePassphrase &&
    new Worker(new URL('livekit-client/e2ee-worker', import.meta.url));
  const e2eeEnabled = !!(e2eePassphrase && worker);
  const keyProvider = new ExternalE2EEKeyProvider();

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = codec ?? 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    return {
      videoCaptureDefaults: {
        deviceId: props.userChoices.videoDeviceId ?? undefined,
        resolution: hq === 'true' ? VideoPresets.h2160 : VideoPresets.h720,
      },
      publishDefaults: {
        dtx: false,
        videoSimulcastLayers:
          hq === 'true'
            ? [VideoPresets.h1080, VideoPresets.h720]
            : [VideoPresets.h540, VideoPresets.h216],
        red: !e2eeEnabled,
        videoCodec,
      },
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
      },
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: true,
      e2ee: e2eeEnabled
        ? {
            keyProvider,
            worker,
          }
        : undefined,
    };
    // @ts-ignore
    setLogLevel('debug', 'lk-e2ee');
  }, [props.userChoices, hq, codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  if (e2eeEnabled) {
    keyProvider.setKey(decodePassphrase(e2eePassphrase));
    room.setE2EEEnabled(true).catch((e) => {
      if (e instanceof DeviceUnsupportedError) {
        alert(
          `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
        );
        console.error(e);
      }
    });
  }
  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  if (!liveKitUrl) {
    return null;
  }

  return (
    <>
      <LiveKitRoom
        room={room}
        token={token}
        serverUrl={liveKitUrl}
        connectOptions={connectOptions}
        video={props.userChoices.videoEnabled}
        audio={props.userChoices.audioEnabled}
        onDisconnected={props.onLeave}
      >
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={
            process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU === 'true' ? SettingsMenu : undefined
          }
        />
        <DebugMode />
        <RecordingIndicator />
      </LiveKitRoom>
    </>
  );
}
