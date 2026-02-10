// frontend/src/components/modals/InputDialog.tsx
import React, { useState, useEffect } from 'react';
import { useInputHandler } from '../../hooks/useInputHandler';
import * as Dialog from '@radix-ui/react-dialog';

const InputDialog: React.FC = () => {
    const { inputRequest, isSubmitting, validateInput, submitValues, cancelInput } = useInputHandler();
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (inputRequest) {
            const initialValues: Record<string, string> = {};
            inputRequest.requests.forEach(req => {
                initialValues[req.variable] = '';
            });
            setFormValues(initialValues);
            setValidationErrors({});
        }
    }, [inputRequest]);

    if (!inputRequest) {
        return null;
    }

    const handleInputChange = (variable: string, value: string) => {
        setFormValues(prev => ({ ...prev, [variable]: value }));
    };

    const handleSubmit = () => {
        const errors: Record<string, string> = {};
        let allValid = true;

        inputRequest.requests.forEach(req => {
            if (!validateInput(formValues[req.variable], req.type)) {
                errors[req.variable] = `Invalid ${req.type}`;
                allValid = false;
            }
        });

        setValidationErrors(errors);

        if (allValid) {
            submitValues(formValues);
        }
    };

    const isOpen = !!inputRequest;

    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => !open && cancelInput()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/50" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-96">
                    <Dialog.Title className="text-lg font-bold">
                        Input Required (Line {inputRequest.line})
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-gray-500 mt-1 mb-4">
                        <code>{inputRequest.code}</code>
                    </Dialog.Description>
                    
                    <div className="space-y-4">
                        {inputRequest.requests.map(req => (
                            <div key={req.variable}>
                                <label htmlFor={req.variable} className="block text-sm font-medium text-gray-700">
                                    Enter value for '{req.variable}' ({req.type}):
                                </label>
                                <input
                                    id={req.variable}
                                    type="text"
                                    value={formValues[req.variable] || ''}
                                    onChange={(e) => handleInputChange(req.variable, e.target.value)}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    disabled={isSubmitting}
                                />
                                {validationErrors[req.variable] && (
                                    <p className="mt-1 text-xs text-red-600">{validationErrors[req.variable]}</p>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 flex justify-end space-x-2">
                        <button
                            onClick={cancelInput}
                            disabled={isSubmitting}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-transparent rounded-md hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Submitting...' : 'Submit'}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default InputDialog;
