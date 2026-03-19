import * as Tabs from '@radix-ui/react-tabs';
import { Box, Clock } from 'lucide-react';
import SymbolNavigator from '@components/sidebar/SymbolNavigator';
import VariableLifetime from '@components/sidebar/VariableLifetime';

export default function Sidebar() {
  return (
    <div className="flex h-full flex-col bg-bg1 border-r border-bd">
      <Tabs.Root defaultValue="symbols" className="flex h-full flex-col">
        {/* Tab List */}
        <Tabs.List className="flex border-b border-bd bg-bg1">
          <Tabs.Trigger
            value="symbols"
            className="flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-t3 hover:text-t1 data-[state=active]:border-b-2 data-[state=active]:border-acc data-[state=active]:text-acc transition-colors"
          >
            <Box className="h-4 w-4" />
            Symbols
          </Tabs.Trigger>

          <Tabs.Trigger
            value="lifetime"
            className="flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-t3 hover:text-t1 data-[state=active]:border-b-2 data-[state=active]:border-acc data-[state=active]:text-acc transition-colors"
          >
            <Clock className="h-4 w-4" />
            Lifetime
          </Tabs.Trigger>
        </Tabs.List>

        {/* Tab Content — Shifted to bg-bg1 to be "less dark" matching prototype */}
        <div className="flex-1 overflow-y-auto bg-bg1">
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