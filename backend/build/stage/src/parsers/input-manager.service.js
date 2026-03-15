class InputManagerService {
    constructor() {
        this.inputLines = new Map(); // line -> { type, varName, format }
    }

    /**
     * Scans code for input operations (cin, scanf)
     * @param {string} code 
     */
    scanCode(code) {
        this.inputLines.clear();
        const lines = code.split('\n');
        
        lines.forEach((line, index) => {
            const lineNum = index + 1;
            const trimmed = line.trim();

            // Detect C++ cin
            // Matches: cin >> x; or std::cin >> x;
            const cinMatch = trimmed.match(/(?:std::)?cin\s*>>\s*([a-zA-Z_]\w*)/);
            if (cinMatch) {
                this.inputLines.set(lineNum, {
                    type: 'cin',
                    varName: cinMatch[1]
                });
                return;
            }

            // Detect C scanf
            // Matches: scanf("%d", &x);
            const scanfMatch = trimmed.match(/scanf\s*\(\s*"([^"]+)"/);
            if (scanfMatch) {
                this.inputLines.set(lineNum, {
                    type: 'scanf',
                    format: scanfMatch[1]
                });
            }
        });

        return this.inputLines;
    }

    isInputLine(line) {
        return this.inputLines.has(line);
    }

    getInputInfo(line) {
        return this.inputLines.get(line);
    }
}

export default new InputManagerService();