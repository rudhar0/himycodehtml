// frontend/src/components/canvas/InputDialog.tsx
import React, { useState, useEffect } from 'react';
import { socketService } from '../../api/socket.service';
import { SOCKET_EVENTS } from '../../constants/events';

interface InputDialogProps {
  isOpen: boolean;
  prompt: string;
  format: string;
  expectedType: string;
  onClose: () => void;
  onSubmit: (value: string | number) => void;
}

export const InputDialog: React.FC<InputDialogProps> = ({
  isOpen,
  prompt,
  format,
  expectedType,
  onClose,
  onSubmit,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = () => {
    if (!inputValue.trim()) {
      setError('Please enter a value');
      return;
    }

    let parsedValue: string | number = inputValue.trim();

    // Parse based on expected type
    if (expectedType === 'int' || format.includes('%d')) {
      const num = parseInt(parsedValue as string, 10);
      if (isNaN(num)) {
        setError('Please enter a valid integer');
        return;
      }
      parsedValue = num;
    } else if (expectedType === 'float' || expectedType === 'double' || format.includes('%f')) {
      const num = parseFloat(parsedValue as string);
      if (isNaN(num)) {
        setError('Please enter a valid number');
        return;
      }
      parsedValue = num;
    } else if (expectedType === 'char' || format.includes('%c')) {
      parsedValue = (parsedValue as string).charAt(0);
    }

    onSubmit(parsedValue);
    onClose();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
    >
      <div
        style={{
          backgroundColor: '#1e293b',
          border: '2px solid #f97316',
          borderRadius: '12px',
          padding: '24px',
          minWidth: '400px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h3
          style={{
            color: '#f97316',
            marginTop: 0,
            marginBottom: '16px',
            fontSize: '18px',
            fontWeight: 'bold',
          }}
        >
          {prompt || 'Enter Input'}
        </h3>

        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'block',
              color: '#cbd5e1',
              marginBottom: '8px',
              fontSize: '14px',
            }}
          >
            Format: {format} ({expectedType})
          </label>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setError('');
            }}
            onKeyPress={handleKeyPress}
            autoFocus
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#0f172a',
              border: error ? '2px solid #ef4444' : '2px solid #475569',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '16px',
              fontFamily: 'monospace',
              outline: 'none',
            }}
            placeholder="Enter value..."
          />
          {error && (
            <div
              style={{
                color: '#ef4444',
                fontSize: '12px',
                marginTop: '8px',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#475569',
              color: '#f8fafc',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '10px 20px',
              backgroundColor: '#f97316',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
};

