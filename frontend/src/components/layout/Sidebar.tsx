import * as Tabs from '@radix-ui/react-tabs';
import { Box, Clock } from 'lucide-react';
import SymbolNavigator from '@components/sidebar/SymbolNavigator';
import VariableLifetime from '@components/sidebar/VariableLifetime';

export default function Sidebar() {
  return (
    <div className="flex h-full flex-col bg-[#f5f7f9] dark:bg-slate-900 border-r border-[#c8d0d8] dark:border-slate-800">
      <Tabs.Root defaultValue="symbols" className="flex h-full flex-col">
        {/* Tab List */}
        <Tabs.List className="flex border-b border-[#c8d0d8] dark:border-slate-800 bg-[#dde3e8] dark:bg-slate-950">
          <Tabs.Trigger
            value="symbols"
            className="flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-[#5a6a7a] dark:text-slate-400 hover:text-[#1a2332] dark:hover:text-slate-200 data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 transition-colors"
          >
            <Box className="h-4 w-4" />
            Symbols
          </Tabs.Trigger>

          <Tabs.Trigger
            value="lifetime"
            className="flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-[#5a6a7a] dark:text-slate-400 hover:text-[#1a2332] dark:hover:text-slate-200 data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 transition-colors"
          >
            <Clock className="h-4 w-4" />
            Lifetime
          </Tabs.Trigger>
        </Tabs.List>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          <Tabs.Content value="symbols" className="h-full">
            <SymbolNavigator />
          </Tabs.Content>

          <Tabs.Content value="lifetime" className="h-full">
            <VariableLifetime />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}