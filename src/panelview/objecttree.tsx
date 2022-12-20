import * as React from 'react';

import { ReactWidget } from '@jupyterlab/apputils';
import {
  LabIcon,
  PanelWithToolbar,
  ToolbarButtonComponent,
  closeIcon
} from '@jupyterlab/ui-components';
import { Panel } from '@lumino/widgets';
import { ReactTree, ThemeSettings, TreeNodeList } from '@naisutech/react-tree';

import visibilitySvg from '../../style/icon/visibility.svg';
import visibilityOffSvg from '../../style/icon/visibilityOff.svg';
import { IJCadModel, IJCadObject } from '../_interface/jcad';
import {
  IControlPanelModel,
  IDict,
  IJupyterCadClientState,
  IJupyterCadDocChange,
  IJupyterCadModel
} from '../types';
import { v4 as uuid } from 'uuid';

const visibilityIcon = new LabIcon({
  name: 'jupytercad:visibilityIcon',
  svgstr: visibilitySvg
});
const visibilityOffIcon = new LabIcon({
  name: 'jupytercad:visibilityOffIcon',
  svgstr: visibilityOffSvg
});

const TREE_THEMES: ThemeSettings = {
  labTheme: {
    text: {
      fontSize: '14px',
      fontFamily: 'var(--jp-ui-font-family)',
      color: 'var(--jp-ui-font-color1)',
      selectedColor: 'var(--jp-ui-inverse-font-color1)',
      hoverColor: 'var(--jp-ui-font-color2)'
    },
    nodes: {
      folder: {
        bgColor: 'var(--jp-layout-color1)',
        selectedBgColor: 'var(--jp-layout-color2)',
        hoverBgColor: 'var(--jp-layout-color2)'
      },
      leaf: {
        bgColor: 'var(--jp-layout-color1)',
        selectedBgColor: 'var(--jp-layout-color2)',
        hoverBgColor: 'var(--jp-layout-color2)'
      },
      icons: {
        size: '9px',
        folderColor: 'var(--jp-inverse-layout-color3)',
        leafColor: 'var(--jp-inverse-layout-color3)'
      }
    }
  }
};

export class ObjectTree extends PanelWithToolbar {
  constructor(params: ObjectTree.IOptions) {
    super(params);
    this.title.label = 'Objects tree';
    const body = ReactWidget.create(
      <ObjectTreeReact cpModel={params.controlPanelModel} />
    );
    this.addWidget(body);
    this.addClass('jpcad-sidebar-treepanel');
  }
}

interface IStates {
  jcadOption?: IDict;
  filePath?: string;
  jcadObject?: IJCadModel;
  lightTheme: boolean;
  selectedNode: string | null;
  clientId: number | null; // ID of the yjs client
  id: string; // ID of the component, it is used to identify which component
  //is the source of awareness updates.
  openNodes: (number | string)[];
}

interface IProps {
  cpModel: IControlPanelModel;
}

class ObjectTreeReact extends React.Component<IProps, IStates> {
  constructor(props: IProps) {
    super(props);

    const lightTheme =
      document.body.getAttribute('data-jp-theme-light') === 'true';

    this.state = {
      filePath: this.props.cpModel.filePath,
      jcadObject: this.props.cpModel.jcadModel?.getAllObject(),
      lightTheme,
      selectedNode: null,
      clientId: null,
      id: uuid(),
      openNodes: []
    };
    this.props.cpModel.jcadModel?.sharedModelChanged.connect(
      this._sharedJcadModelChanged
    );
    this.props.cpModel.documentChanged.connect((_, document) => {
      if (document) {
        this.props.cpModel.disconnect(this._sharedJcadModelChanged);
        this.props.cpModel.disconnect(this._handleThemeChange);
        this.props.cpModel.disconnect(this._onClientSharedStateChanged);

        document.context.model.sharedModelChanged.connect(
          this._sharedJcadModelChanged
        );
        document.context.model.themeChanged.connect(this._handleThemeChange);
        document.context.model.clientStateChanged.connect(
          this._onClientSharedStateChanged
        );
        this.setState(old => ({
          ...old,
          filePath: document.context.localPath,
          jcadObject: this.props.cpModel.jcadModel?.getAllObject(),
          clientId: document.context.model.getClientId()
        }));
      } else {
        this.setState({
          filePath: undefined,
          jcadObject: undefined,
          jcadOption: undefined
        });
      }
    });
  }

  stateToTree = () => {
    if (this.state.jcadObject) {
      return this.state.jcadObject.map(obj => {
        const name = obj.name;
        const items: TreeNodeList = [];
        if (obj.shape) {
          items.push({
            id: `${name}#shape#${obj.shape}#${this.state.filePath}`,
            label: 'Shape',
            parentId: name
          });
        }
        if (obj.operators) {
          items.push({
            id: `${name}#operator#${this.state.filePath}`,
            label: 'Operators',
            parentId: name
          });
        }
        return {
          id: name,
          label: obj.name ?? `Object (#${name})`,
          parentId: null,
          items
        };
      });
    }

    return [];
  };

  getObjectFromName(name: string | null): IJCadObject | undefined {
    if (name && this.state.jcadObject) {
      const obj = this.state.jcadObject.filter(o => o.name === name);
      if (obj.length > 0) {
        return obj[0];
      }
    }
  }

  private _handleThemeChange = (): void => {
    const lightTheme =
      document.body.getAttribute('data-jp-theme-light') === 'true';
    this.setState(old => ({ ...old, lightTheme }));
  };

  private _sharedJcadModelChanged = (
    sender: IJupyterCadModel,
    change: IJupyterCadDocChange
  ): void => {
    if (change.objectChange) {
      this.setState(old => ({
        ...old,
        jcadObject: this.props.cpModel.jcadModel?.getAllObject()
      }));
    }
  };

  private _onClientSharedStateChanged = (
    sender: IJupyterCadModel,
    clients: Map<number, IJupyterCadClientState>
  ): void => {
    const targetId: number | null = null;
    const clientId = this.state.clientId;
    if (targetId) {
      //TODO Fix selection logic.
    } else {
      // Update from other components of current client
      const localState = clientId ? clients.get(clientId) : null;
      if (localState) {
        // This is also triggered when an object is selected and the pointer changes
        // re-rendering the tree multiple times
        if (localState.selected?.emitter && localState.selected?.value) {
          const selectedNode = localState.selected.value;
          this.setState(old => ({ ...old, selectedNode }));
        }
      }
    }
  };

  render(): React.ReactNode {
    const { selectedNode } = this.state;
    const data = this.stateToTree();
    let selectedNodes: (number | string)[] = [];
    if (selectedNode) {
      const parentNode = data.filter(node => node.id === selectedNode);
      if (parentNode.length > 0 && parentNode[0].items.length > 0) {
        selectedNodes = [parentNode[0].items[0].id];
      }
    }

    return (
      <div className="jpcad-treeview-wrapper">
        <ReactTree
          nodes={data}
          selectedNodes={selectedNodes}
          messages={{ noData: 'No data' }}
          theme={'labTheme'}
          themes={TREE_THEMES}
          onToggleSelectedNodes={id => {
            if (id && id.length > 0) {
              let name = id[0] as string;
              if (name.includes('#')) {
                name = name.split('#')[0];

                this.props.cpModel.jcadModel?.syncSelectedObject(
                  name,
                  this.state.id
                );
              }
            } else {
              this.props.cpModel.jcadModel?.syncSelectedObject(undefined);
            }
          }}
          RenderNode={options => {
            // const paddingLeft = 25 * (options.level + 1);
            const jcadObj = this.getObjectFromName(
              options.node.parentId as string
            );
            let visible = false;
            if (jcadObj) {
              visible = jcadObj.visible;
            }
            return (
              <div
                className={`jpcad-control-panel-tree ${
                  options.selected ? 'selected' : ''
                }`}
              >
                <div
                  style={{
                    paddingLeft: '5px',
                    minHeight: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minWidth: 0
                  }}
                >
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflowX: 'hidden'
                    }}
                  >
                    {options.node.label}
                  </span>
                  {options.type === 'leaf' ? (
                    <div style={{ display: 'flex' }}>
                      <ToolbarButtonComponent
                        className={'jp-ToolbarButtonComponent'}
                        onClick={() => {
                          const objectId = options.node.parentId as string;
                          this.props.cpModel.jcadModel?.sharedModel.updateObjectByName(
                            objectId,
                            'visible',
                            !visible
                          );
                        }}
                        icon={visible ? visibilityIcon : visibilityOffIcon}
                      />
                      <ToolbarButtonComponent
                        className={'jp-ToolbarButtonComponent'}
                        onClick={() => {
                          const objectId = options.node.parentId as string;
                          this.props.cpModel.jcadModel?.sharedModel.removeObjectByName(
                            objectId
                          );
                          this.props.cpModel.jcadModel?.syncSelectedObject(
                            undefined
                          );
                        }}
                        icon={closeIcon}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      </div>
    );
  }
}
export namespace ObjectTree {
  /**
   * Instantiation options for `ObjectTree`.
   */
  export interface IOptions extends Panel.IOptions {
    controlPanelModel: IControlPanelModel;
  }
}
