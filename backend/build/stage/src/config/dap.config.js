import dotenv from 'dotenv';
dotenv.config();

const dapConfig = {
  dapAdapterPath: process.env.DAP_ADAPTER_PATH || '/path/to/your/cpptools/debugAdapters/OpenDebugAD7',
  gdbPath: process.env.GDB_PATH || '/usr/bin/gdb',
};

export default dapConfig;
