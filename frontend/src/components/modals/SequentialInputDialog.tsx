import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  InputRequirement,
  InputValueType,
  validateInputValue,
} from '../../utils/inputRequirements';
import { ensureInputDialogHost } from '../../utils/inputDialogHost';

interface SequentialInputDialogProps {
  isOpen: boolean;
  requirement: InputRequirement | null;
  index: number;
  total: number;
  entered: Array<{ variable: string; value: string; type: InputValueType }>;
  onSubmit: (value: string) => void;
  onBack?: () => void;
  onCancel: () => void;
}

export function SequentialInputDialog({
  isOpen,
  requirement,
  index,
  total,
  entered,
  onSubmit,
  onBack,
  onCancel,
}: SequentialInputDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setValue('');
    setError('');
  }, [isOpen, requirement?.id]);

  const host = useMemo(() => ensureInputDialogHost(), [isOpen]);
  if (!isOpen || !requirement || !host) return null;

  const submit = () => {
    const valid = validateInputValue(value, requirement.type);
    if (valid == null) {
      setError(`Invalid ${requirement.type} value`);
      return;
    }
    onSubmit(valid);
  };

  return createPortal(
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(8, 15, 30, 0.68)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(560px, 92vw)',
          borderRadius: 12,
          background: '#f7f8fa',
          border: '1px solid #c9d0d8',
          boxShadow: '0 16px 40px rgba(0,0,0,0.3)',
          padding: 18,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 13, color: '#44515e', marginBottom: 6 }}>
          Program requires input ({index + 1}/{total})
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#12202f', marginBottom: 8 }}>
          {requirement.prompt}
        </div>
        <div style={{ fontSize: 12, color: '#5a6878', marginBottom: 12 }}>
          Line {requirement.line} • {requirement.callType} • {requirement.type}
        </div>

        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={`Enter ${requirement.variable}`}
          style={{
            width: '100%',
            borderRadius: 8,
            border: error ? '2px solid #c73a3a' : '1px solid #93a1b1',
            background: '#fff',
            color: '#132335',
            fontSize: 16,
            padding: '10px 12px',
            outline: 'none',
          }}
        />
        {error && (
          <div style={{ marginTop: 6, color: '#b42323', fontSize: 12 }}>{error}</div>
        )}

        {entered.length > 0 && (
          <div
            style={{
              marginTop: 12,
              borderRadius: 8,
              border: '1px solid #d8dee6',
              background: '#eef2f7',
              padding: 8,
              maxHeight: 120,
              overflowY: 'auto',
              fontSize: 12,
              color: '#344354',
            }}
          >
            {entered.map((item, i) => (
              <div key={`${item.variable}-${i}`}>
                {item.variable} ({item.type}) = {item.value}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          {index > 0 && onBack && (
            <button
              onClick={onBack}
              style={{
                border: '1px solid #8fa0b3',
                borderRadius: 8,
                background: '#e7edf4',
                color: '#1f2f41',
                padding: '8px 12px',
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          )}
          <button
            onClick={onCancel}
            style={{
              border: '1px solid #8fa0b3',
              borderRadius: 8,
              background: '#e7edf4',
              color: '#1f2f41',
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            Use Defaults
          </button>
          <button
            onClick={submit}
            style={{
              border: '1px solid #1a69b8',
              borderRadius: 8,
              background: '#1e7cd8',
              color: '#fff',
              padding: '8px 12px',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}

export default SequentialInputDialog;
