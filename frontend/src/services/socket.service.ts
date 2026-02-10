
// Compatibility re-export for older imports using /src/services/... path
import defaultExport, { socketService } from '../api/socket.service';

export { socketService };
export default defaultExport;
