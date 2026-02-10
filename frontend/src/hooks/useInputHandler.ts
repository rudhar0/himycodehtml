// frontend/src/hooks/useInputHandler.ts
import { useInputStore } from '../store/slices/inputSlice';
import { socketService } from '../api/socket.service';

export const useInputHandler = () => {
    const { inputRequest, isSubmitting, setInputRequest, clearInputRequest, setIsSubmitting } = useInputStore();

    const validateInput = (value: string, type: 'int' | 'float' | 'char' | 'string'): boolean => {
        if (value.trim() === '') return false;
        
        switch (type) {
            case 'int':
                return /^-?\d+$/.test(value);
            case 'float':
                return /^-?\d+(\.\d+)?$/.test(value);
            case 'char':
                return value.length === 1;
            case 'string':
                return true; // Any non-empty string is valid
            default:
                return false;
        }
    };

    const submitValues = (values: Record<string, string>) => {
        if (!inputRequest) return;

        setIsSubmitting(true);
        const inputValues = inputRequest.requests.map(req => values[req.variable]);
        
        // Send the formatted input string to the backend via socket
        socketService.sendInput(inputValues.join(' '));

        // The backend will eventually send a 'TRACE_COMPLETE' or new 'EXECUTION_STEP',
        // which should trigger the input dialog to close.
        // We can clear it optimistically after a short delay, or wait for the backend event.
        // Waiting is safer. For now, we'll let the existing socket handlers manage clearing the request.
    };

    const cancelInput = () => {
        clearInputRequest();
        // Optionally, notify the backend that execution is cancelled.
        // This might involve stopping the debugger process.
    };

    return {
        inputRequest,
        isSubmitting,
        validateInput,
        submitValues,
        cancelInput,
        setInputRequest, // Exposing for external triggers, e.g. from socket event handlers
    };
};
