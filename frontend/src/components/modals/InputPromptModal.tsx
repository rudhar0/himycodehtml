import { useState } from 'react';
import { useInputStore } from '@store/slices/inputSlice';
import useSocket from '@hooks/useSocket';
import Dialog from '@components/ui/Dialog';
import Input from '@components/ui/Input';
import Button from '@components/ui/Button';

export function InputPromptModal() {
  const { isWaitingForInput, prompt, clearInputRequired } = useInputStore();
  const { provideInput } = useSocket();
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = () => {
    provideInput(inputValue);
    clearInputRequired();
    setInputValue('');
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSubmit();
    }
  };

  if (!isWaitingForInput) {
    return null;
  }

  return (
    <Dialog open={isWaitingForInput} onOpenChange={(isOpen) => !isOpen && clearInputRequired()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Input Required</Dialog.Title>
          <Dialog.Description>{prompt}</Dialog.Description>
        </Dialog.Header>
        <div className="grid gap-4 py-4">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter input..."
            autoFocus
          />
        </div>
        <Dialog.Footer>
          <Button onClick={handleSubmit}>Submit</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
