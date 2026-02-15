import { useState } from 'react';
import { useInputStore } from '@store/slices/inputSlice';
import useSocket from '@hooks/useSocket';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@components/ui/Dialog';
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Input Required</DialogTitle>
          <DialogDescription>{prompt}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter input..."
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
