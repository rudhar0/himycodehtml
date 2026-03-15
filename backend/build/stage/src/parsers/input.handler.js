import debuggerService from '../services/debugger.service.js';

export default function registerInputHandlers(io, socket) {
    socket.on('execution:provide_input', async (data) => {
        try {
            console.log(`[InputHandler] Received input: ${data.value}`);
            await debuggerService.provideInput(data.value);
        } catch (error) {
            console.error('[InputHandler] Error providing input:', error);
            socket.emit('execution:error', { 
                message: 'Failed to process input: ' + error.message 
            });
        }
    });
}