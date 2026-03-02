class Node {}
class Shape extends Node {}
class Container extends Node {
  getLayer() {
    return null;
  }
}

class Group extends Container {}
class Layer extends Container {}
class Rect extends Shape {}
class Text extends Shape {
  text(value?: string) {
    return value ?? "";
  }
}
class Arrow extends Shape {}
class Circle extends Shape {}
class Line extends Shape {}
class Path extends Shape {}

const Konva = {
  Node,
  Shape,
  Container,
  Group,
  Layer,
  Rect,
  Text,
  Arrow,
  Circle,
  Line,
  Path,
};

export default Konva;
