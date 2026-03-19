import PlaybackControls from '@components/controls/PlaybackControls';
import TimelineScrubber from '@components/controls/TimelineScrubber';
import SpeedControl from '@components/controls/SpeedControl';
import StepInfo from '@components/controls/StepInfo';

export default function ControlBar() {
  return (
    <div className="flex h-20 flex-col border-t border-bd bg-bg1">
      {/* Top Row: Playback Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-bd">
        <PlaybackControls />
        <SpeedControl />
      </div>

      {/* Bottom Row: Timeline & Step Info */}
      <div className="flex items-center gap-4 px-4 py-2">
        <div className="flex-1">
          <TimelineScrubber />
        </div>
        <div className="w-80">
          <StepInfo />
        </div>
      </div>
    </div>
  );
}