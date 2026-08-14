import { usePlayerStore } from '../store/player';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Track } from '../store/library';
import { X, Play, DotsSixVertical, Trash } from '@phosphor-icons/react';

function SortableTrackItem({
  track,
  id,
  isCurrent,
  onPlay,
  onRemove,
}: {
  track: Track;
  id: string;
  isCurrent: boolean;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    gap: '8px',
    borderRadius: 'var(--radius-xs)',
    backgroundColor: isDragging
      ? 'var(--surface-selected)'
      : isCurrent
      ? 'var(--surface-active)'
      : 'transparent',
    marginBottom: 2,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
        <DotsSixVertical size={14} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: isCurrent ? 600 : 500,
            color: isCurrent ? 'var(--accent)' : 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {track.title || track.path.split(/[\\/]/).pop()}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {track.artist || 'Unknown Artist'}
        </div>
      </div>

      <button
        className="btn-icon"
        style={{ width: 24, height: 24 }}
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        title="Play Track"
      >
        <Play size={12} weight="fill" />
      </button>

      <button
        className="btn-icon"
        style={{ width: 24, height: 24 }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function QueuePanel() {
  const { queue, currentIndex, reorderQueue, play } = usePlayerStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = queue.findIndex((t, i) => `${t.id}-${i}` === active.id);
      const newIndex = queue.findIndex((t, i) => `${t.id}-${i}` === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderQueue(oldIndex, newIndex);
      }
    }
  };

  const handleRemoveTrack = (index: number) => {
    const newQueue = [...queue];
    newQueue.splice(index, 1);
    let newIndex = currentIndex;
    if (index < currentIndex) {
      newIndex--;
    } else if (index === currentIndex && newIndex >= newQueue.length) {
      newIndex = newQueue.length - 1;
    }
    usePlayerStore.setState({ queue: newQueue, currentIndex: newIndex });
  };

  const handleClearQueue = () => {
    usePlayerStore.setState({ queue: [], currentIndex: -1, isPlaying: false });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--divider-subtle)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Up Next ({queue.length})
        </div>
        {queue.length > 0 && (
          <button
            className="btn-secondary"
            style={{ fontSize: 11, height: 24, padding: '0 8px' }}
            onClick={handleClearQueue}
            title="Clear Queue"
          >
            <Trash size={12} />
            <span>Clear</span>
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {queue.length === 0 ? (
          <div className="empty-library-state" style={{ padding: '60px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Up Next is empty</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              Queue tracks from your library to play next.
            </div>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={queue.map((t, i) => `${t.id}-${i}`)} strategy={verticalListSortingStrategy}>
              {queue.map((track, i) => (
                <SortableTrackItem
                  key={`${track.id}-${i}`}
                  id={`${track.id}-${i}`}
                  track={track}
                  isCurrent={i === currentIndex}
                  onPlay={() => {
                    usePlayerStore.setState({ currentIndex: i });
                    play(track);
                  }}
                  onRemove={() => handleRemoveTrack(i)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
