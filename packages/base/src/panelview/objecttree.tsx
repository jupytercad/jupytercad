import {
  IDict,
  IJCadModel,
  IJCadObject,
  IJcadObjectDocChange,
  IJupyterCadClientState,
  IJupyterCadDoc,
  IJupyterCadModel
} from '@jupytercad/schema';
import { ReactWidget } from '@jupyterlab/apputils';
import {
  closeIcon,
  PanelWithToolbar,
  ToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { JSONObject } from '@lumino/coreutils';
import { Panel } from '@lumino/widgets';
import {
  ReactTree,
  ThemeSettings,
  TreeNodeId,
  TreeNodeList
} from '@naisutech/react-tree';
import * as React from 'react';
import { v4 as uuid } from 'uuid';

import { IControlPanelModel } from '../types';
import { visibilityIcon, visibilityOffIcon } from '../tools';

export const TREE_THEMES: ThemeSettings = {
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
  options?: JSONObject;
  lightTheme: boolean;
  selectedNodes: string[];
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
      selectedNodes: [],
      clientId: null,
      id: uuid(),
      openNodes: []
    };
    this.props.cpModel.jcadModel?.sharedObjectsChanged.connect(
      this._sharedJcadModelChanged
    );
    this.props.cpModel.documentChanged.connect((_, document) => {
      if (document) {
        this.props.cpModel.disconnect(this._sharedJcadModelChanged);
        this.props.cpModel.disconnect(this._handleThemeChange);
        this.props.cpModel.disconnect(this._onClientSharedStateChanged);

        document.context.model.sharedObjectsChanged.connect(
          this._sharedJcadModelChanged
        );
        document.context.model.themeChanged.connect(this._handleThemeChange);
        document.context.model.clientStateChanged.connect(
          this._onClientSharedStateChanged
        );
        document.context.model.sharedOptionsChanged.connect(
          this._onClientSharedOptionsChanged
        );

        this.setState(old => ({
          ...old,
          filePath: document.context.localPath,
          jcadObject: this.props.cpModel.jcadModel?.getAllObject(),
          options: this.props.cpModel.sharedModel?.options,
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
    sender: IJupyterCadDoc,
    change: IJcadObjectDocChange
  ): void => {
    if (change.objectChange) {
      this.setState(old => ({
        ...old,
        jcadObject: this.props.cpModel.jcadModel?.getAllObject(),
        options: this.props.cpModel.sharedModel?.options
      }));
    }
  };

  private _onClientSharedStateChanged = (
    sender: IJupyterCadModel,
    clients: Map<number, IJupyterCadClientState>
  ): void => {
    const localState = this.props.cpModel.jcadModel?.localState;

    if (!localState) {
      return;
    }

    let selectedNodes: string[] = [];
    if (localState.remoteUser) {
      // We are in following mode.
      // Sync selections from a remote user
      const remoteState = clients.get(localState.remoteUser);

      if (remoteState?.selected?.value) {
        selectedNodes = remoteState.selected.value;
      }
    } else if (localState.selected?.value) {
      selectedNodes = localState.selected.value;
    }

    const openNodes = [...this.state.openNodes];

    for (const selectedNode of selectedNodes) {
      if (selectedNode && openNodes.indexOf(selectedNode) === -1) {
        openNodes.push(selectedNode);
      }
    }

    this.setState(old => ({ ...old, openNodes, selectedNodes }));
  };

  private _onClientSharedOptionsChanged = (
    sender: IJupyterCadDoc,
    clients: any
  ): void => {
    this.setState(old => ({ ...old, options: sender.options }));
  };

  render(): React.ReactNode {
    const { selectedNodes, openNodes, options } = this.state;
    const data = this.stateToTree();

    const selectedNodeIds: TreeNodeId[] = [];
    for (const selectedNode of selectedNodes) {
      const parentNode = data.filter(node => node.id === selectedNode);
      if (parentNode.length > 0 && parentNode[0].items.length > 0) {
        selectedNodeIds.push(parentNode[0].items[0].id);
      }
    }
    return (
      <div className="jpcad-treeview-wrapper">
        <ReactTree
          multiSelect={true}
          nodes={data}
          openNodes={openNodes}
          selectedNodes={selectedNodeIds}
          messages={{ noData: 'No data' }}
          theme={'labTheme'}
          themes={TREE_THEMES}
          onToggleSelectedNodes={id => {
            if (id === selectedNodeIds) {
              return;
            }

            if (id && id.length > 0) {
              const names: string[] = [];
              for (const subid of id) {
                const name = subid as string;

                if (name.includes('#')) {
                  names.push(name.split('#')[0]);
                } else {
                  names.push(name);
                }
              }

              this.props.cpModel.jcadModel?.syncSelectedObject(
                names,
                this.state.id
              );
            } else {
              this.props.cpModel.jcadModel?.syncSelectedObject([]);
            }
          }}
          RenderNode={opts => {
            // const paddingLeft = 25 * (opts.level + 1);
            const jcadObj = this.getObjectFromName(
              opts.node.parentId as string
            );
            let visible = true;
            if (jcadObj) {
              visible = jcadObj.visible;
            }
            if (
              jcadObj &&
              options &&
              options['guidata'] &&
              Object.prototype.hasOwnProperty.call(
                options['guidata'],
                jcadObj.name
              ) &&
              Object.prototype.hasOwnProperty.call(
                options['guidata'][jcadObj.name],
                'visibility'
              )
            ) {
              visible = options['guidata'][jcadObj.name]['visibility'];
            }
            return (
              <div
                className={`jpcad-control-panel-tree ${
                  opts.selected ? 'selected' : ''
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
                    {opts.node.label}
                  </span>
                  {opts.type === 'leaf' ? (
                    <div style={{ display: 'flex' }}>
                      <ToolbarButtonComponent
                        className={'jp-ToolbarButtonComponent'}
                        onClick={() => {
                          const objectId = opts.node.parentId as string;
                          const guidata =
                            this.props.cpModel.sharedModel?.getOption(
                              'guidata'
                            ) || { [objectId]: {} };
                          if (guidata) {
                            if (guidata[objectId]) {
                              guidata[objectId]['visibility'] = !visible;
                            } else {
                              guidata[objectId] = { visibility: !visible };
                            }
                          }
                          this.props.cpModel.sharedModel?.setOption(
                            'guidata',
                            guidata
                          );
                        }}
                        icon={visible ? visibilityIcon : visibilityOffIcon}
                      />
                      <ToolbarButtonComponent
                        className={'jp-ToolbarButtonComponent'}
                        onClick={() => {
                          const objectId = opts.node.parentId as string;
                          this.props.cpModel.jcadModel?.sharedModel.removeObjectByName(
                            objectId
                          );
                          this.props.cpModel.jcadModel?.syncSelectedObject([]);
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
