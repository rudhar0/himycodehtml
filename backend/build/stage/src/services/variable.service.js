import DebuggerService from '../routes/debugger.service.js';

class VariableService {
  async getScopedVariables() {
    const locals = await DebuggerService.getLocalVariables();
    if (locals.error) {
      return locals;
    }

    const variables = [];
    for (const local of locals) {
      const variable = await this.buildVariableObject(local.name);
      variables.push(variable);
    }
    return variables;
  }

  async buildVariableObject(expression) {
    const variableObject = await DebuggerService.createVariable(expression);
    if (!variableObject || variableObject.error) {
      return { name: expression, value: 'Error creating variable' };
    }

    const { name, value, numchild, type } = variableObject;
    const variable = { name, value, type };

    if (numchild > 0) {
      variable.children = await this.getChildVariables(name);
    }

    return variable;
  }

  async getChildVariables(variableName) {
    const children = await DebuggerService.listVariableChildren(variableName);
    if (!children || children.error) {
      return [];
    }

    const childVariables = [];
    for (const child of children) {
      const childVariable = await this.buildVariableObject(child.name);
      childVariables.push(childVariable);
    }
    return childVariables;
  }
}

export default new VariableService();
